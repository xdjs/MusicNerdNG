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

export async function getConfirmedSteps(artistId: string): Promise<Set<OnboardingStep>> {
    try {
        const rows = await db.query.artistOnboardingSteps.findMany({
            where: eq(artistOnboardingSteps.artistId, artistId),
        });
        return new Set(rows.map(r => r.step as OnboardingStep));
    } catch (e) {
        console.error("[getConfirmedSteps] Error:", e);
        return new Set();
    }
}

/** Written ONLY by an explicit artist action in the chat. Idempotent (two-tab safe). */
export async function confirmOnboardingStep(artistId: string, step: OnboardingStep): Promise<void> {
    await db
        .insert(artistOnboardingSteps)
        .values({ artistId, step })
        .onConflictDoNothing({ target: [artistOnboardingSteps.artistId, artistOnboardingSteps.step] });
}

export async function getOnboardingState(artistId: string): Promise<OnboardingState> {
    const confirmed = await getConfirmedSteps(artistId);
    return { complete: confirmed.has("publish"), currentStep: firstUnconfirmedStep(confirmed) };
}

export async function upsertInterviewAnswer(input: {
    artistId: string;
    questionKey: string;
    question: string;
    answer: string | null;
    source: "onboarding" | "followup";
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
