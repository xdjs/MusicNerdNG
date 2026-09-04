import { db } from "@/server/db/drizzle";
import { eq, sql } from "drizzle-orm";
import { artistDocs, artistInterviewAnswers, artistOnboardingSteps } from "@/server/db/schema";

/**
 * Post-claim onboarding state. The step order is the chat's forced chain.
 * There is NO stored cursor: the current step is always the first step
 * lacking an explicit confirmation row (see the design spec §5).
 */
export const ONBOARDING_STEPS = ["profiles", "vault", "interview", "publish"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export type OnboardingState = { complete: boolean; currentStep: OnboardingStep | null };

/** Pure derivation — unit-test this, it is where the resume logic lives. */
export function firstUnconfirmedStep(confirmed: ReadonlySet<string>): OnboardingStep | null {
    for (const step of ONBOARDING_STEPS) {
        if (!confirmed.has(step)) return step;
    }
    return null;
}

/** `null` return means the read FAILED (e.g. migration not applied, missing
 *  grants) — distinguishable from a brand-new claimant with zero confirmed
 *  steps (an empty Set). Callers MUST treat `null` as "unknown", never as
 *  "incomplete, start at profiles" — conflating the two fails OPEN into a
 *  permanent stuck takeover for every claimant whenever this read breaks. */
export async function getConfirmedSteps(artistId: string): Promise<Set<OnboardingStep> | null> {
    try {
        const rows = await db.query.artistOnboardingSteps.findMany({
            where: eq(artistOnboardingSteps.artistId, artistId),
        });
        return new Set(rows.map(r => r.step as OnboardingStep));
    } catch (e) {
        console.error("[getConfirmedSteps] Error:", e);
        return null;
    }
}

/** Written ONLY by an explicit artist action in the chat. Idempotent (two-tab safe). */
export async function confirmOnboardingStep(artistId: string, step: OnboardingStep): Promise<void> {
    await db
        .insert(artistOnboardingSteps)
        .values({ artistId, step })
        .onConflictDoNothing({ target: [artistOnboardingSteps.artistId, artistOnboardingSteps.step] });
}

/** `null` return means onboarding state is UNKNOWN (the confirmed-steps read
 *  failed) — callers must render/act as if there is no onboarding takeover at
 *  all, not fall back to a default state (spec fail-CLOSED requirement). */
export async function getOnboardingState(artistId: string): Promise<OnboardingState | null> {
    const confirmed = await getConfirmedSteps(artistId);
    if (confirmed === null) return null;
    return { complete: confirmed.has("publish"), currentStep: firstUnconfirmedStep(confirmed) };
}

export async function upsertInterviewAnswer(input: {
    artistId: string;
    questionKey: string;
    question: string;
    answer: string | null;
    /** Used only if this is the INSERT side of the upsert. The conflict update
     *  deliberately never changes the sitting already stored on the row. */
    sitting: number;
    /** "offered" is a question we PUT to them that they have not dealt with
     *  yet — the boundary of a sitting. It becomes "followup" the moment they
     *  answer it or skip it. Without it there is no way to tell a sitting
     *  somebody abandoned from one they finished, because a lifetime row count
     *  cannot see where one offer ended and the next began. */
    source: "onboarding" | "followup" | "offered";
}): Promise<void> {
    await db
        .insert(artistInterviewAnswers)
        .values(input)
        .onConflictDoUpdate({
            target: [artistInterviewAnswers.artistId, artistInterviewAnswers.questionKey],
            set: {
                question: input.question,
                answer: input.answer,
                source: input.source,
                // PRESERVE THE OFFER-TIME WATERMARK for panel questions. The
                // questions can only represent material known when they were
                // offered. If research finishes while a full sitting waits and
                // answering re-stamps this later, the newly learned rows fall
                // before the next cutoff and are never eligible for a follow-up.
                // A direct onboarding-chat upsert has no preceding `offered`
                // row, so it retains the existing answer-time behaviour.
                createdAt: sql`CASE
                    WHEN ${artistInterviewAnswers.source} = 'offered'
                    THEN ${artistInterviewAnswers.createdAt}
                    ELSE (now() AT TIME ZONE 'utc'::text)
                END`,
                // `sitting` IS DELIBERATELY ABSENT FROM THIS SET LIST. Answering
                // a question must leave its stored membership intact.
            },
        });
}

/**
 * Write down a batch of questions PUT to somebody, and never anything more.
 *
 * Insert-only, deliberately. The upsert version read the existing rows and then
 * wrote nulls, so an artist who answered the first question in the moment
 * between those two steps had their answer overwritten with `answer: null` —
 * losing what they had just typed, on the one screen in the product where the
 * words are theirs.
 *
 * `onConflictDoNothing` removes the race rather than narrowing it: a row that
 * exists, for any reason, in any order, is left exactly as it is.
 */
export async function recordInterviewBatchOffered(
    artistId: string,
    questions: Array<{
        questionKey: string;
        question: string;
    }>,
): Promise<void> {
    if (questions.length === 0) return;

    // WHICH SITTING THIS BELONGS TO, decided here because this is the only
    // place questions are put to an artist. Computing it once for the batch is
    // what guarantees every question visible in one panel shares a boundary.
    //
    // An open row means a sitting is already in front of them, and anything
    // offered now is part of it — that is what a top-up is, when a resumed
    // sitting has fewer questions left than a full one. Otherwise this starts a
    // new sitting.
    //
    // NOT DERIVED FROM TIMESTAMPS. Five attempts did that and each had a hole,
    // because `upsertInterviewAnswer` re-stamps `created_at` on answer and
    // destroys the offer time that identifies the sitting. A topped-up row
    // outliving the rows it was added to then reads as a sitting of its own.
    let sitting = 1;
    try {
        const rows = await db.select({ sitting: artistInterviewAnswers.sitting, source: artistInterviewAnswers.source })
            .from(artistInterviewAnswers)
            .where(eq(artistInterviewAnswers.artistId, artistId));
        const open = rows.find(r => r.source === "offered");
        if (open) {
            // Join the sitting in progress. Null is a pre-0022 row, which is
            // always sitting 1.
            sitting = open.sitting ?? 1;
        } else if (rows.length > 0) {
            sitting = Math.max(...rows.map(r => r.sitting ?? 1)) + 1;
        }
    } catch (e) {
        // Falling back to 1 makes a returning artist look new, which offers
        // them a generic question they may not want — annoying, and better
        // than throwing away the offer entirely.
        console.error("[recordInterviewBatchOffered] Could not read sitting:", e);
    }

    await db
        .insert(artistInterviewAnswers)
        .values(questions.map(question => ({
            artistId,
            ...question,
            answer: null,
            source: "offered" as const,
            sitting,
        })))
        .onConflictDoNothing({
            target: [artistInterviewAnswers.artistId, artistInterviewAnswers.questionKey],
        });
}

/**
 * `null` means WE DO NOT KNOW, which is not the same as "they have answered
 * nothing".
 *
 * Returning [] on a failure told the interview that a database blip was a
 * blank slate — so it would offer a first sitting to somebody who had already
 * done one, and re-ask every question they had answered. Callers that only
 * want to READ answers can treat null as empty; the one that decides whether to
 * ask has to stop.
 */
export async function getInterviewAnswers(artistId: string) {
    try {
        return await db.query.artistInterviewAnswers.findMany({
            where: eq(artistInterviewAnswers.artistId, artistId),
            orderBy: (a, { asc }) => [asc(a.createdAt)],
        });
    } catch (e) {
        console.error("[getInterviewAnswers] Error:", e);
        return null;
    }
}

export async function upsertArtistDoc(artistId: string, content: string): Promise<void> {
    await db
        .insert(artistDocs)
        .values({ artistId, content })
        .onConflictDoUpdate({
            target: [artistDocs.artistId],
            set: { content, updatedAt: sql`(now() AT TIME ZONE 'utc'::text)` },
        });
}

/** Separate call from `upsertArtistDoc` on purpose — that function's 2-arg
 *  (artistId, content) call site is load-bearing for existing tests, so the
 *  citation manifest is persisted as its own UPDATE instead of a third arg.
 *  Always called immediately after `upsertArtistDoc` in the same publish
 *  handler, so the row is guaranteed to already exist. */
export async function upsertArtistDocSources(artistId: string, sources: unknown[]): Promise<void> {
    await db
        .update(artistDocs)
        .set({ sources, updatedAt: sql`(now() AT TIME ZONE 'utc'::text)` })
        .where(eq(artistDocs.artistId, artistId));
}

/**
 * The same read as `getArtistDoc`, but it LETS THE ERROR OUT.
 *
 * `getArtistDoc` catches and returns `undefined`, which a caller cannot tell
 * apart from "this artist has no document". That is right for a page that
 * degrades to hiding a section, and wrong for anything that must answer
 * differently: the public /artist/<id>/llms.txt returns 404 for no document, a
 * status a crawler is entitled to cache and stop asking about. A database blip
 * answering 404 would quietly tell every model that an artist we know plenty
 * about has nothing.
 */
export async function getArtistDocStrict(artistId: string) {
    return await db.query.artistDocs.findFirst({
        where: eq(artistDocs.artistId, artistId),
    });
}

export async function getArtistDoc(artistId: string) {
    try {
        return await db.query.artistDocs.findFirst({
            where: eq(artistDocs.artistId, artistId),
        });
    } catch (e) {
        console.error("[getArtistDoc] Error:", e);
        return undefined;
    }
}
