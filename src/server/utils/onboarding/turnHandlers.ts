/**
 * The forced onboarding chain. The SERVER owns the step sequence; the model
 * never decides what happens next. Every handler is idempotent — a re-run
 * after a disconnect upserts the same state and continues (spec §6, §9).
 */
import { db } from "@/server/db/drizzle";
import { eq } from "drizzle-orm";
import { artists } from "@/server/db/schema";
import { getArtistById } from "@/server/utils/queries/artistQueries";
import {
    getVaultSourcesByArtistId,
    getVaultSourceByIdAndArtist,
    updateVaultSourceStatus,
    saveBioVersion,
    insertVaultSource,
    updateVaultSourceContent,
} from "@/server/utils/queries/dashboardQueries";
import { searchAndPopulateVault } from "@/server/utils/queries/vaultWebSearch";
import { isUnsafeUrl, fetchPageContent } from "@/server/utils/fetchPageContent";
import { inferTypeFromUrl } from "@/lib/sourceTypes";
import {
    type OnboardingStep,
    getOnboardingState,
    confirmOnboardingStep,
    getInterviewAnswers,
    upsertInterviewAnswer,
    upsertArtistDoc,
} from "@/server/utils/queries/onboardingQueries";
import { setArtistLink, clearArtistLink } from "@/server/utils/artistLinkService";
import { extractArtistId } from "@/server/utils/services";
import { musicPlatformData } from "@/server/utils/musicPlatform";
import { synthesizeArtistDoc, generateAboutFromDoc, ARTIST_DOC_MAX_CHARS, GEMINI_TIMEOUT_MS } from "@/server/utils/artistDocService";
import { ONBOARDING_QUESTIONS } from "./questions";
import { MAX_BIO_LENGTH, isRealBio } from "@/lib/bioConstants";
import { getGemini, GEMINI_MODEL_FLASH } from "@/server/lib/gemini";

/** Two ungrounded Gemini calls, each with one retry at up to `GEMINI_TIMEOUT_MS`,
 *  is a 4x-call worst case (~80s) against `maxDuration = 60` on the chat route.
 *  Once the publish step has already burned this much wall-clock time, skip any
 *  further retry and let the failure propagate — the step stays unconfirmed and
 *  the next turn resumes it (spec §9), instead of blowing past the deadline. */
const PUBLISH_RETRY_BUDGET_MS = GEMINI_TIMEOUT_MS + 10_000;

export type TurnEvent =
    | { kind: "chat"; text: string }
    | { kind: "progress"; label: string; done: boolean }
    | { kind: "step"; step: OnboardingStep; payload: unknown }
    | { kind: "draft"; doc: string; about: string }
    | { kind: "complete" }
    | { kind: "error"; message: string };

export type ClientTurn =
    | { type: "open" }
    | { type: "confirm_profiles"; addedLinks: { url: string }[]; removedSiteNames: string[] }
    | { type: "vault_review"; decisions: { sourceId: string; status: "approved" | "rejected" }[]; addedUrls: string[] }
    | { type: "interview_answer"; questionKey: string; answer: string | null }
    | { type: "publish"; doc: string; about: string };

// Link columns surfaced as profile cards (display subset of the writable whitelist).
const PROFILE_DISPLAY_COLUMNS = [
    "spotify", "deezer", "instagram", "tiktok", "x", "youtube",
    "soundcloud", "bandcamp", "twitch", "facebook",
] as const;

const NARRATION = {
    welcome: "Welcome! Your profile is officially yours — let's get it into shape. This takes about two minutes, and you can pick it back up anytime.",
    welcomeBack: "Welcome back — picking up right where you left off.",
    alreadyDone: "You're all set — your profile is published. You can edit anything from your page whenever you like.",
    profiles: "First: here's everything we have linked to you. Leaving a card as-is confirms it — remove anything that isn't you, or paste a link we missed.",
    profilesDone: "Profiles confirmed. Now let's look at what the internet says about you.",
    vault: "We found these sources about you. Keep what's accurate — they feed your About page and the AI that answers fan questions.",
    vaultEmpty: "We didn't find much about you on the web yet — no problem. Paste a link to press, an interview, or your own site below, or just continue.",
    vaultDone: "Sources sorted. Now the fun part — three quick questions. Skip any of them.",
    generating: "Okay, I have everything I need. Watch this — I'm writing your About page from your links, your sources, and your own words.",
    draftReady: "There it is. Publish it as-is, or copy it out and tweak — your call.",
    published: "You're live! 🎉 Your About is published, and everything you shared is saved as your artist doc — it now powers your page's Q&A and fun facts too.",
} as const;

/** One warm Gemini sentence reacting to an interview answer. Bounded at 5s;
 *  any failure falls back to a template — the ack is garnish, never a blocker. */
async function generateInterviewAck(question: string, answer: string): Promise<string> {
    const FALLBACK = "Love that — noted, in your words.";
    try {
        const response = await Promise.race([
            getGemini().models.generateContent({
                model: GEMINI_MODEL_FLASH,
                contents: `The artist was asked: "${question}" and answered: "${answer}". Reply with ONE short, warm, specific sentence reacting to their answer. No questions, no emoji, no hype words.`,
                config: { temperature: 0.7 },
            }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("ack timeout")), 5000)),
        ]);
        return response.text?.trim() || FALLBACK;
    } catch {
        return FALLBACK;
    }
}

async function buildProfilesPayload(artistId: string) {
    const artist = await getArtistById(artistId);
    if (!artist) throw new Error(`Artist not found: ${artistId}`);
    const record = artist as unknown as Record<string, unknown>;
    const links = PROFILE_DISPLAY_COLUMNS.flatMap(col => {
        const value = record[col];
        return typeof value === "string" && value ? [{ siteName: col, value }] : [];
    });
    const enrichment = await musicPlatformData.getArtist(artist).catch(() => null);
    return {
        artistName: artist.name ?? "your profile",
        links,
        enrichment: enrichment
            ? { platform: enrichment.platform, followerCount: enrichment.followerCount, imageUrl: enrichment.imageUrl }
            : null,
    };
}

/** Emit the entry payload for a step. The interview case advances itself when done. */
async function* emitStep(artistId: string, step: OnboardingStep): AsyncGenerator<TurnEvent> {
    switch (step) {
        case "profiles": {
            yield { kind: "progress", label: "Gathering your profiles", done: false };
            const payload = await buildProfilesPayload(artistId);
            yield { kind: "progress", label: "Gathering your profiles", done: true };
            yield { kind: "chat", text: NARRATION.profiles };
            yield { kind: "step", step: "profiles", payload };
            return;
        }
        case "vault": {
            let pending = await getVaultSourcesByArtistId(artistId, "pending");
            if (pending.length === 0) {
                // Approval-time discovery may have found nothing or still be running.
                // Re-run ONLY when the vault is entirely empty (spec §4). Bounded
                // ~38s inside the route's 55s deadline; failure degrades gracefully.
                const approved = await getVaultSourcesByArtistId(artistId, "approved");
                if (approved.length === 0) {
                    yield { kind: "progress", label: "Searching the web for sources about you", done: false };
                    try {
                        await searchAndPopulateVault(artistId);
                        pending = await getVaultSourcesByArtistId(artistId, "pending");
                    } catch (e) {
                        console.error("[onboarding] vault discovery failed:", e);
                    }
                    yield { kind: "progress", label: "Searching the web for sources about you", done: true };
                }
            }
            yield { kind: "chat", text: pending.length > 0 ? NARRATION.vault : NARRATION.vaultEmpty };
            yield {
                kind: "step",
                step: "vault",
                payload: { sources: pending.map(s => ({ id: s.id, title: s.title, url: s.url, snippet: s.snippet })) },
            };
            return;
        }
        case "interview": {
            const asked = new Set((await getInterviewAnswers(artistId)).map(a => a.questionKey));
            const nextIndex = ONBOARDING_QUESTIONS.findIndex(q => !asked.has(q.key));
            if (nextIndex === -1) {
                await confirmOnboardingStep(artistId, "interview");
                yield* emitStep(artistId, "publish");
                return;
            }
            const next = ONBOARDING_QUESTIONS[nextIndex];
            yield { kind: "chat", text: next.question };
            yield {
                kind: "step",
                step: "interview",
                payload: { questionKey: next.key, question: next.question, number: nextIndex + 1, total: ONBOARDING_QUESTIONS.length },
            };
            return;
        }
        case "publish": {
            yield { kind: "chat", text: NARRATION.generating };
            yield { kind: "progress", label: "Reading your sources and answers", done: false };
            const publishStartedAt = Date.now();
            // Gemini failure policy: apologize in-stream, retry ONCE, else let the
            // throw reach the route (error event; checkpoint stays unmet — spec §9).
            // The retry is skipped once we're already past budget so the worst
            // case fits `maxDuration` instead of stacking to ~80s (see
            // PUBLISH_RETRY_BUDGET_MS above).
            let doc: string;
            try {
                doc = await synthesizeArtistDoc(artistId);
            } catch (e) {
                if (Date.now() - publishStartedAt > PUBLISH_RETRY_BUDGET_MS) throw e;
                yield { kind: "chat", text: "Hmm, that didn't come together — give me one more second." };
                doc = await synthesizeArtistDoc(artistId);
            }
            yield { kind: "progress", label: "Reading your sources and answers", done: true };
            yield { kind: "progress", label: "Writing your About", done: false };
            const artist = await getArtistById(artistId);
            let about: string;
            try {
                about = await generateAboutFromDoc(artist?.name ?? "this artist", doc);
            } catch (e) {
                if (Date.now() - publishStartedAt > PUBLISH_RETRY_BUDGET_MS) throw e;
                yield { kind: "chat", text: "One more try on the wording…" };
                about = await generateAboutFromDoc(artist?.name ?? "this artist", doc);
            }
            yield { kind: "progress", label: "Writing your About", done: true };
            // Turns are stateless: the draft round-trips through the client and
            // comes back in the publish turn (spec §6, advisor FIX 1).
            yield { kind: "draft", doc, about };
            yield { kind: "chat", text: NARRATION.draftReady };
            return;
        }
    }
}

export async function* runOnboardingTurn(artistId: string, turn: ClientTurn): AsyncGenerator<TurnEvent> {
    const state = await getOnboardingState(artistId);
    // `null` = the confirmed-steps read failed (e.g. migration/grants issue) —
    // state is UNKNOWN, not "incomplete". Never guess a step or write anything;
    // error out and let the next turn retry the read (fail CLOSED — spec C1).
    if (state === null) {
        yield { kind: "error", message: "We couldn't load your onboarding status — try again in a moment." };
        return;
    }

    if (turn.type === "open") {
        if (state.complete || state.currentStep === null) {
            yield { kind: "chat", text: NARRATION.alreadyDone };
            yield { kind: "complete" };
            return;
        }
        yield { kind: "chat", text: state.currentStep === "profiles" ? NARRATION.welcome : NARRATION.welcomeBack };
        yield* emitStep(artistId, state.currentStep);
        return;
    }

    if (turn.type === "confirm_profiles") {
        // Gate on the derived step so a stale re-enabled card (e.g. a second
        // browser tab left open on an already-confirmed step) can't overwrite
        // state out of order — resync instead of acting (spec I1).
        if (state.currentStep === null) {
            yield { kind: "chat", text: NARRATION.alreadyDone };
            yield { kind: "complete" };
            return;
        }
        if (state.currentStep !== "profiles") {
            yield { kind: "error", message: "We're not quite there yet — let's finish the earlier steps first." };
            yield* emitStep(artistId, state.currentStep);
            return;
        }
        const failures: string[] = [];
        for (const siteName of turn.removedSiteNames ?? []) {
            try {
                await clearArtistLink(artistId, siteName);
            } catch (e) {
                console.error(`[onboarding] clearArtistLink failed for ${siteName}:`, e);
            }
        }
        for (const raw of turn.addedLinks ?? []) {
            try {
                const extracted = await extractArtistId(raw.url);
                if (!extracted?.siteName || !extracted?.id) {
                    failures.push(raw.url);
                    continue;
                }
                await setArtistLink(artistId, extracted.siteName, extracted.id);
            } catch (e) {
                console.error(`[onboarding] setArtistLink failed for ${raw.url}:`, e);
                failures.push(raw.url);
            }
        }
        await confirmOnboardingStep(artistId, "profiles");
        if (failures.length > 0) {
            yield {
                kind: "chat",
                text: `Heads up — I couldn't recognize ${failures.length === 1 ? "one of your links" : `${failures.length} of your links`}. You can add ${failures.length === 1 ? "it" : "them"} anytime from the Social Links section of your page.`,
            };
        }
        yield { kind: "chat", text: NARRATION.profilesDone };
        yield* emitStep(artistId, "vault");
        return;
    }

    if (turn.type === "vault_review") {
        // Gate on the derived step (spec I1) — see confirm_profiles above.
        if (state.currentStep === null) {
            yield { kind: "chat", text: NARRATION.alreadyDone };
            yield { kind: "complete" };
            return;
        }
        if (state.currentStep !== "vault") {
            yield { kind: "error", message: "We're not quite there yet — let's finish the earlier steps first." };
            yield* emitStep(artistId, state.currentStep);
            return;
        }
        for (const decision of turn.decisions ?? []) {
            // Ownership: only touch sources that belong to THIS artist.
            const source = await getVaultSourceByIdAndArtist(decision.sourceId, artistId);
            if (!source) continue;
            await updateVaultSourceStatus(decision.sourceId, decision.status);
        }
        // Artist-pasted links go straight to approved — they added them themselves.
        for (const url of turn.addedUrls ?? []) {
            try {
                if (isUnsafeUrl(url)) continue;
                const source = await insertVaultSource({ artistId, url, type: inferTypeFromUrl(url), status: "approved" });
                // Fire-and-forget content enrichment (title/snippet/extractedText) so
                // doc synthesis isn't left with a bare URL — mirrors addVaultSource's
                // background fetch pattern (src/app/actions/dashboardActions.ts).
                if (source?.id) {
                    fetchPageContent(url).then(content => {
                        updateVaultSourceContent(source.id, {
                            title: content.title,
                            snippet: content.snippet,
                            extractedText: content.extractedText,
                            ogImage: content.ogImage,
                        }).catch(e => console.error("[onboarding] Background content update failed:", e));
                    }).catch(e => console.error("[onboarding] Background fetch failed:", e));
                }
            } catch (e) {
                console.error(`[onboarding] insertVaultSource failed for ${url}:`, e);
            }
        }
        await confirmOnboardingStep(artistId, "vault");
        yield { kind: "chat", text: NARRATION.vaultDone };
        yield* emitStep(artistId, "interview");
        return;
    }

    if (turn.type === "interview_answer") {
        // Gate on the derived step (spec I1) — see confirm_profiles above. Without
        // this, a stale re-enabled card can overwrite a real answer with NULL via
        // onConflictDoUpdate.
        if (state.currentStep === null) {
            yield { kind: "chat", text: NARRATION.alreadyDone };
            yield { kind: "complete" };
            return;
        }
        if (state.currentStep !== "interview") {
            yield { kind: "error", message: "We're not quite there yet — let's finish the earlier steps first." };
            yield* emitStep(artistId, state.currentStep);
            return;
        }
        const question = ONBOARDING_QUESTIONS.find(q => q.key === turn.questionKey);
        if (!question) {
            yield { kind: "error", message: "Unknown question — let's continue from where we were." };
            yield* emitStep(artistId, "interview"); // step guard above already pinned currentStep === "interview"
            return;
        }
        const answer = turn.answer?.trim() || null;
        await upsertInterviewAnswer({
            artistId,
            questionKey: question.key,
            question: question.question,
            answer,
            source: "onboarding",
        });
        if (answer) {
            yield { kind: "chat", text: await generateInterviewAck(question.question, answer) };
        }
        // On resume, ask the first question lacking a row — answered or skipped
        // questions are never re-asked (spec §6). emitStep handles completion.
        yield* emitStep(artistId, "interview");
        return;
    }

    if (turn.type === "publish") {
        if (state.currentStep === null) {
            yield { kind: "chat", text: NARRATION.alreadyDone };
            yield { kind: "complete" };
            return;
        }
        if (state.currentStep !== "publish") {
            yield { kind: "error", message: "We're not quite there yet — let's finish the earlier steps first." };
            if (state.currentStep) yield* emitStep(artistId, state.currentStep);
            return;
        }
        const doc = turn.doc?.trim();
        const about = turn.about?.trim();
        if (!doc || doc.length > ARTIST_DOC_MAX_CHARS) {
            yield { kind: "error", message: "That doc looks off — let me regenerate it." };
            yield* emitStep(artistId, "publish");
            return;
        }
        if (!about || about.length > MAX_BIO_LENGTH) {
            yield { kind: "error", message: "That About looks off — let me regenerate it." };
            yield* emitStep(artistId, "publish");
            return;
        }
        // Snapshot a pre-existing REAL bio before it's overwritten. An artist who
        // hand-edited their About via updateArtistBio/saveBio has a live bio with
        // NO version row — publishing here must not destroy it irrecoverably. The
        // empty-state/claim-nudge bio is not real content and is never versioned.
        // Any failure here (e.g. version cap reached) should fail the publish, not
        // silently proceed to overwrite an unsaved bio — do not swallow it.
        const existingArtist = await getArtistById(artistId);
        const existingBio = existingArtist?.bio;
        if (isRealBio(existingBio)) {
            await saveBioVersion(artistId, existingBio as string);
        }
        await upsertArtistDoc(artistId, doc);
        await saveBioVersion(artistId, about);
        // The ONLY implicit artists.bio write in this feature — the explicit
        // publish moment (spec §6). Later doc regens never touch the bio.
        await db.update(artists).set({ bio: about }).where(eq(artists.id, artistId));
        await confirmOnboardingStep(artistId, "publish");
        yield { kind: "chat", text: NARRATION.published };
        yield { kind: "complete" };
        return;
    }

    if (state.currentStep === null) {
        yield { kind: "chat", text: NARRATION.alreadyDone };
        yield { kind: "complete" };
        return;
    }
    yield { kind: "error", message: "I didn't understand that — let's continue." };
    yield* emitStep(artistId, state.currentStep);
}
