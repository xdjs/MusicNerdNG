/**
 * The forced onboarding chain. The SERVER owns the step sequence; the model
 * never decides what happens next. Every handler is idempotent — a re-run
 * after a disconnect upserts the same state and continues (spec §6, §9).
 */
import { db } from "@/server/db/drizzle";
import { eq } from "drizzle-orm";
import { artists } from "@/server/db/schema";
import { getArtistById, getAllLinks } from "@/server/utils/queries/artistQueries";
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
import { fetchLinkPreview } from "@/server/utils/linkPreview";
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
import { discoverArtistProfilesStream, type DiscoveredProfile } from "@/server/utils/profileDiscovery";
import { PROFILE_DISPLAY_COLUMNS, buildLinkPresentationMeta } from "@/server/utils/linkPresentation";
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
    // Incremental live feedback while the profiles step's discovery runs —
    // fired the instant a candidate clears validation, ahead of the terminal
    // `step` event. Additive only: the terminal `step` event's payload still
    // carries the complete candidate list (the source of truth for a page
    // reload/resume), so a client that ignores `candidate` entirely still
    // renders correctly, just without the live-discovery feel.
    | { kind: "candidate"; profile: DiscoveredProfile }
    | { kind: "draft"; doc: string; about: string }
    | { kind: "complete" }
    | { kind: "error"; message: string };

export type ClientTurn =
    | { type: "open" }
    | { type: "confirm_profiles"; addedLinks: { url: string }[]; removedSiteNames: string[] }
    | { type: "vault_review"; decisions: { sourceId: string; status: "approved" | "rejected" }[]; addedUrls: string[] }
    | { type: "interview_answer"; questionKey: string; answer: string | null }
    | { type: "publish"; doc: string; about: string };

const NARRATION = {
    welcome: "Welcome! Your profile is officially yours — let's get it into shape. This takes about two minutes, and you can pick it back up anytime.",
    welcomeBack: "Welcome back — picking up right where you left off.",
    alreadyDone: "You're all set — your profile is published. You can edit anything from your page whenever you like.",
    profiles: "First: here's everything we have linked to you. Leaving a card as-is confirms it — remove anything that isn't you, or paste a link we missed.",
    profilesEmpty: "Let's start with where people can find you. Paste your Spotify, Instagram, or anywhere else you live online — or skip ahead and add them later.",
    profilesCandidatesFound: (count: number) =>
        `I also found ${count} more ${pluralize(count, "profile", "profiles")} by searching the web — take a look below and confirm the ones that are yours, then let me know if anything's still missing.`,
    profilesDone: "Profiles confirmed. Now let's look at what the internet says about you.",
    vault: (count: number) =>
        `We found ${count} ${pluralize(count, "source", "sources")} about you. Keep what's accurate — they feed your About page and the AI that answers fan questions.`,
    vaultEmpty: "We didn't find much about you on the web yet — no problem. Paste a link to press, an interview, or your own site below, or just continue.",
    vaultDone: "Sources sorted. Now the fun part — three quick questions. Skip any of them.",
    generating: "Okay, I have everything I need — writing your About page now from your links, your sources, and your own answers.",
    draftReady: "Your About is ready. Publish it as-is, or edit it first — your call.",
    published: "You're live! Your About is published, and everything you shared is saved as your artist doc — it now powers your page's Q&A and fun facts too.",
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

// --- confirm_profiles failure messaging (Bug 3) -------------------------
// Two distinct failure causes need distinct copy: a link we couldn't even
// parse (no username/profile path) vs. a link we understood but the DB
// write rejected (e.g. a unique-constraint collision — already linked to
// another profile). Conflating them as "unrecognized" is misleading in the
// second case, so each gets its own message naming the offending link(s).

const FAILURE_URL_DISPLAY_MAX = 48;

/** Truncate a long URL sensibly for inline chat copy. */
function truncateUrlForDisplay(url: string): string {
    return url.length > FAILURE_URL_DISPLAY_MAX ? `${url.slice(0, FAILURE_URL_DISPLAY_MAX - 1)}…` : url;
}

function formatFailedLinkList(urls: string[]): string {
    return urls.map(truncateUrlForDisplay).join(", ");
}

function pluralize(count: number, singular: string, plural: string): string {
    return count === 1 ? singular : plural;
}

/** extractArtistId returned nothing — the URL didn't include a recognizable
 *  username/profile path (e.g. a bare `https://www.instagram.com/`). Keeps
 *  the phrase "couldn't recognize" for backward compatibility with earlier
 *  copy, while now naming the offending link(s) and explaining why.
 *
 *  `blocked` must match what actually happens next: when the step is about
 *  to be re-emitted for a retry (Bug 2's all-failed path) the closing line
 *  invites a paste; when the step is confirming and advancing to vault
 *  instead, inviting a paste right before "Profiles confirmed" would be a
 *  message that doesn't match reality — so it points to Social Links later. */
function buildUnrecognizedLinksMessage(urls: string[], blocked: boolean): string {
    const list = formatFailedLinkList(urls);
    const noun = pluralize(urls.length, "one of your links", `${urls.length} of your links`);
    const subject = urls.length === 1 ? "It" : "They";
    const verb = pluralize(urls.length, "doesn't", "don't");
    const linkNoun = pluralize(urls.length, "a direct profile link", "direct profile links");
    const tail = blocked
        ? "paste the profile URL and I'll try again."
        : `you can add ${pluralize(urls.length, "it", "them")} anytime from the Social Links section of your page.`;
    return `Heads up — I couldn't recognize ${noun}: ${list}. ${subject} ${verb} look like ${linkNoun} (no username or handle at the end) — ${tail}`;
}

/** setArtistLink threw — extraction succeeded but the write was rejected,
 *  most likely a unique-constraint collision (already linked elsewhere).
 *  Deliberately avoids the word "recognize" so it reads as a different
 *  failure than buildUnrecognizedLinksMessage. See `blocked` note above. */
function buildWriteRejectedLinksMessage(urls: string[], blocked: boolean): string {
    const list = formatFailedLinkList(urls);
    const noun = pluralize(urls.length, "one of your links", `${urls.length} of your links`);
    const pronoun = pluralize(urls.length, "it's", "they're");
    const tail = blocked
        ? "try a different link, or reach out if that seems wrong."
        : "you can try again anytime from the Social Links section of your page, or reach out if that seems wrong.";
    return `Heads up — I couldn't save ${noun}: ${list}. Looks like ${pronoun} already linked to another profile on Music Nerd — ${tail}`;
}

/** Bug 2 recovery copy: every submitted link failed and nothing ended up
 *  saved, so the profiles step is re-emitted instead of being confirmed. */
const PROFILES_RETRY_NUDGE = "Nothing saved yet — let's fix that before moving on. Paste the direct profile link below and I'll give it another shot.";

/** Bounds the whole preview-gathering phase so a slow/hostile site can never
 *  blow the turn budget — links whose preview didn't resolve in time simply
 *  get `previewImage: null`. Each individual `fetchLinkPreview` call already
 *  carries its own ~4s hard timeout and never throws; this is a second,
 *  belt-and-suspenders cap on the batch as a whole. */
const PROFILE_PREVIEW_BUDGET_MS = 5000;

/** Fetch link previews for every {siteName, profileUrl} pair, all in
 *  parallel, bounded by PROFILE_PREVIEW_BUDGET_MS overall. Never throws;
 *  entries that fail or don't resolve in time are simply absent from the
 *  returned map (callers treat a miss as `null`). */
async function gatherProfilePreviews(entries: [siteName: string, profileUrl: string][]): Promise<Map<string, string | null>> {
    const settled = new Map<string, string | null>();
    if (entries.length === 0) return settled;
    const gathering = Promise.all(entries.map(async ([siteName, profileUrl]) => {
        const preview = await fetchLinkPreview(profileUrl);
        settled.set(siteName, preview.imageUrl);
    }));
    let timer: ReturnType<typeof setTimeout>;
    const budget = new Promise<void>(resolve => { timer = setTimeout(resolve, PROFILE_PREVIEW_BUDGET_MS); });
    try {
        await Promise.race([gathering, budget]);
    } finally {
        clearTimeout(timer!);
    }
    return settled;
}

async function buildProfilesPayload(artistId: string) {
    const artist = await getArtistById(artistId);
    if (!artist) throw new Error(`Artist not found: ${artistId}`);
    const record = artist as unknown as Record<string, unknown>;
    const rawLinks = PROFILE_DISPLAY_COLUMNS.flatMap(col => {
        const value = record[col];
        return typeof value === "string" && value ? [{ siteName: col as string, value }] : [];
    });

    // Presentation metadata (logo/color/display name/profile URL) comes from
    // urlmap, keyed by siteName. A failed lookup must never break the onboarding
    // turn — degrade every link back to the bare {siteName, value} shape.
    let metaBySiteName: Map<string, { displayName: string; logoUrl: string | null; colorHex: string | null; profileUrl: string | null }> | null = null;
    try {
        const allLinks = await getAllLinks();
        const bySiteName = new Map(allLinks.map(l => [l.siteName, l]));
        metaBySiteName = new Map(
            rawLinks.map(({ siteName, value }) => [siteName, buildLinkPresentationMeta(bySiteName.get(siteName), siteName, value)] as const),
        );
    } catch (e) {
        console.error("[onboarding] getAllLinks failed, degrading profile cards to bare shape:", e);
    }

    // Real artist-photo previews for the card avatars. Bounded + parallel
    // (never sequential) and run concurrently with the enrichment lookup
    // below rather than before it, so the two don't stack on the turn's
    // wall-clock budget.
    const previewTargets: [string, string][] = [];
    for (const [siteName, meta] of metaBySiteName ?? []) {
        if (meta.profileUrl) previewTargets.push([siteName, meta.profileUrl]);
    }
    const [previewBySiteName, enrichment] = await Promise.all([
        gatherProfilePreviews(previewTargets),
        musicPlatformData.getArtist(artist).catch(() => null),
    ]);

    const links = rawLinks.map(({ siteName, value }) => {
        const meta = metaBySiteName?.get(siteName);
        if (!meta) return { siteName, value };
        const previewImage = meta.profileUrl ? (previewBySiteName.get(siteName) ?? null) : null;
        return { siteName, value, ...meta, previewImage };
    });

    return {
        artistName: artist.name ?? "your profile",
        links,
        enrichment: enrichment
            ? { platform: enrichment.platform, followerCount: enrichment.followerCount, imageUrl: enrichment.imageUrl }
            : null,
    };
}

/** Emit the entry payload for a step. The interview case advances itself when done.
 *  `discoverProfiles` gates the auto-discovery search (Gemini + validation, up to
 *  ~25s) that only makes sense on a FRESH entry into the profiles step (from
 *  `open`) — re-emissions after a failed confirm or an out-of-step resync would
 *  otherwise stack another ~25s of search on top of write work already done this
 *  turn, for no benefit (the artist already saw the candidates once). */
async function* emitStep(artistId: string, step: OnboardingStep, discoverProfiles = false): AsyncGenerator<TurnEvent> {
    switch (step) {
        case "profiles": {
            yield { kind: "progress", label: "Gathering your profiles", done: false };
            const payload = await buildProfilesPayload(artistId);
            yield { kind: "progress", label: "Gathering your profiles", done: true };

            // Streamed live: each platform lookup renders as "searching" the
            // instant it starts and flips to a checkmark the instant it
            // settles, and every validated candidate renders the instant it's
            // found — never a silent wait followed by one batch dump. The
            // generator itself never throws (profileDiscovery.ts's contract),
            // but the try/catch here is defense-in-depth so a bug in the
            // stream can't take down the whole `profiles` turn.
            const candidates: DiscoveredProfile[] = [];
            if (discoverProfiles) {
                try {
                    for await (const event of discoverArtistProfilesStream(artistId)) {
                        switch (event.kind) {
                            case "searching":
                                yield { kind: "progress", label: `Searching ${event.displayName}`, done: false };
                                break;
                            case "checked":
                                yield { kind: "progress", label: `Searching ${event.displayName}`, done: true };
                                break;
                            case "found":
                                candidates.push(event.profile);
                                yield { kind: "candidate", profile: event.profile };
                                break;
                        }
                    }
                } catch (e) {
                    console.error("[onboarding] profile discovery stream failed:", e);
                }
            }

            const baseNarration = payload.links.length > 0 ? NARRATION.profiles : NARRATION.profilesEmpty;
            const narration = candidates.length > 0
                ? `${baseNarration} ${NARRATION.profilesCandidatesFound(candidates.length)}`
                : baseNarration;
            yield { kind: "chat", text: narration };
            yield { kind: "step", step: "profiles", payload: { ...payload, candidates } };
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
            yield { kind: "chat", text: pending.length > 0 ? NARRATION.vault(pending.length) : NARRATION.vaultEmpty };
            yield {
                kind: "step",
                step: "vault",
                payload: { sources: pending.map(s => ({ id: s.id, title: s.title, url: s.url, snippet: s.snippet, ogImage: s.ogImage ?? null })) },
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
        // Discovery only runs on a fresh/resumed entry into the profiles step —
        // see the `discoverProfiles` doc comment on emitStep.
        yield* emitStep(artistId, state.currentStep, state.currentStep === "profiles");
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
        for (const siteName of turn.removedSiteNames ?? []) {
            try {
                await clearArtistLink(artistId, siteName);
            } catch (e) {
                console.error(`[onboarding] clearArtistLink failed for ${siteName}:`, e);
            }
        }

        // Bug 3: track the two failure causes separately — a URL we couldn't
        // parse at all (unrecognized) vs. one we parsed fine but whose write
        // was rejected (e.g. a unique-constraint collision) — they get
        // different copy below.
        const unrecognized: string[] = [];
        const writeRejected: string[] = [];
        for (const raw of turn.addedLinks ?? []) {
            let extracted;
            try {
                extracted = await extractArtistId(raw.url);
            } catch (e) {
                console.error(`[onboarding] extractArtistId failed for ${raw.url}:`, e);
                unrecognized.push(raw.url);
                continue;
            }
            if (!extracted?.siteName || !extracted?.id) {
                unrecognized.push(raw.url);
                continue;
            }
            try {
                await setArtistLink(artistId, extracted.siteName, extracted.id);
            } catch (e) {
                console.error(`[onboarding] setArtistLink failed for ${raw.url}:`, e);
                writeRejected.push(raw.url);
            }
        }

        // Bug 2: never infer success from the request payload — a write can
        // silently fail. Re-read the artist's own link columns (the same set
        // buildProfilesPayload uses) so "at least one link" reflects reality.
        const artistAfterWrites = await getArtistById(artistId);
        const linkRecord = (artistAfterWrites ?? {}) as unknown as Record<string, unknown>;
        const hasAtLeastOneLink = PROFILE_DISPLAY_COLUMNS.some(col => {
            const value = linkRecord[col];
            return typeof value === "string" && value.length > 0;
        });
        const submittedAdditions = (turn.addedLinks ?? []).length > 0;
        const allAdditionsFailed = submittedAdditions
            && unrecognized.length + writeRejected.length === (turn.addedLinks ?? []).length;

        if (submittedAdditions && allAdditionsFailed && !hasAtLeastOneLink) {
            // The user submitted links, every single one failed, and the
            // artist still has zero saved links. Do NOT confirm/advance —
            // that would show "Profiles confirmed" over an empty profile
            // (the exact bug seen in live testing). Report what went wrong
            // and re-emit the profiles step as the recovery path.
            if (unrecognized.length > 0) yield { kind: "chat", text: buildUnrecognizedLinksMessage(unrecognized, true) };
            if (writeRejected.length > 0) yield { kind: "chat", text: buildWriteRejectedLinksMessage(writeRejected, true) };
            yield { kind: "chat", text: PROFILES_RETRY_NUDGE };
            yield* emitStep(artistId, "profiles");
            return;
        }

        await confirmOnboardingStep(artistId, "profiles");
        if (unrecognized.length > 0) yield { kind: "chat", text: buildUnrecognizedLinksMessage(unrecognized, false) };
        if (writeRejected.length > 0) yield { kind: "chat", text: buildWriteRejectedLinksMessage(writeRejected, false) };
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
