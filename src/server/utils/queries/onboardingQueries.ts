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
            set: { question: input.question, answer: input.answer, source: input.source },
        });
}

export async function getInterviewAnswers(artistId: string) {
    try {
        return await db.query.artistInterviewAnswers.findMany({
            where: eq(artistInterviewAnswers.artistId, artistId),
            orderBy: (a, { asc }) => [asc(a.createdAt)],
        });
    } catch (e) {
        console.error("[getInterviewAnswers] Error:", e);
        return [];
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
