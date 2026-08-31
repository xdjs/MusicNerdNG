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
import { isCitableSource } from "@/server/utils/sourceVerification";
import { fetchLinkPreview } from "@/server/utils/linkPreview";
import { inferTypeFromUrl } from "@/lib/sourceTypes";
import {
    type OnboardingStep,
    getOnboardingState,
    confirmOnboardingStep,
    getInterviewAnswers,
    upsertInterviewAnswer,
    upsertArtistDoc,
    upsertArtistDocSources,
} from "@/server/utils/queries/onboardingQueries";
import { setArtistLink, clearArtistLink } from "@/server/utils/artistLinkService";
import {
    contradictsScrapedPosts, handleBelongsToAnotherArtist, nameIsAmbiguousInDirectory,
} from "@/server/utils/artistIdentityGuards";
import { extractArtistId } from "@/server/utils/services";
import { musicPlatformData } from "@/server/utils/musicPlatform";
import {
    synthesizeArtistDoc,
    generateAboutFromDoc,
    synthesizeFallbackAbout,
    buildDocSources,
    extractCitedIds,
    stripCitationMarkers,
    ARTIST_DOC_MAX_CHARS,
    GEMINI_TIMEOUT_MS,
    refreshArtistDoc,
    type DocSource,
} from "@/server/utils/artistDocService";
import { discoverArtistProfilesStream, titleMatchesArtist, type DiscoveredProfile } from "@/server/utils/profileDiscovery";
import { PROFILE_DISPLAY_COLUMNS, buildLinkPresentationMeta } from "@/server/utils/linkPresentation";
import { ONBOARDING_QUESTIONS } from "./questions";
import { MAX_BIO_LENGTH, isRealBio } from "@/lib/bioConstants";
import { getGemini, GEMINI_MODEL_FLASH } from "@/server/lib/gemini";
import { after } from "next/server";
import { generateGroundedQuestions, GROUNDED_QUESTION_KEY_PREFIX, type GroundedQuestion } from "@/server/utils/questionGenerator";
import { waitForSocialPosts } from "@/server/utils/socialIngest";
import { requestArtistResearch } from "@/server/utils/researchRunner";

const MAX_DOC_SOURCES = 200;

/** `turn.sources` is client-echoed (the same stateless round-trip as doc/about)
 *  but, unlike those two, lands directly in a stored jsonb column — validated
 *  defensively rather than trusted, same caution as the route's array-length
 *  guards on decisions/addedLinks/addedUrls. Anything malformed is dropped
 *  rather than failing the whole publish; a missing/garbled manifest just
 *  means the doc temporarily has no citation panel, not a lost publish. */
function sanitizeDocSources(input: unknown): DocSource[] {
    if (!Array.isArray(input)) return [];
    const out: DocSource[] = [];
    for (const item of input.slice(0, MAX_DOC_SOURCES)) {
        if (!item || typeof item !== "object") continue;
        const { id, kind, label, url } = item as Record<string, unknown>;
        if (typeof id !== "number" || !Number.isFinite(id)) continue;
        if (kind !== "vault" && kind !== "interview" && kind !== "social") continue;
        if (typeof label !== "string") continue;
        if (url !== null && typeof url !== "string") continue;
        out.push({ id, kind, label, url: url ?? null });
    }
    return out;
}

/** Two ungrounded Gemini calls, each with one retry at up to `GEMINI_TIMEOUT_MS`,
 *  is a 4x-call worst case (~80s) against `maxDuration = 60` on the chat route.
 *  Once the publish step has already burned this much wall-clock time, skip any
 *  further retry and let the failure propagate — the step stays unconfirmed and
 *  the next turn resumes it (spec §9), instead of blowing past the deadline. */
const PUBLISH_RETRY_BUDGET_MS = GEMINI_TIMEOUT_MS + 10_000;

/** Progress-event group id for the profiles step's per-platform search
 *  (see emitStep's "profiles" case). Up to ~9 platforms are probed across
 *  4 tiers plus handle-propagation re-probes, out of order and sometimes
 *  repeated (e.g. Instagram can be searched 3x as confirmed handles
 *  propagate) — collapsing them under one group id lets the client render
 *  ONE live line instead of a chip per platform per attempt. */
const PROFILE_SEARCH_GROUP = "platform-search";
/** Progress groups for the auto-build's three stages, so each collapses to one
 *  line that flips to done rather than a stream of separate entries. */
const VAULT_SEARCH_GROUP = "source-search";
const DOC_GROUP = "about-write";

export type TurnEvent =
    | { kind: "chat"; text: string }
    // `group` is set only for progress events that belong to a collapsible
    // batch (currently just the profiles step's per-platform search) — see
    // PROFILE_SEARCH_GROUP below. Omitted (undefined) for every standalone
    // progress step, which keeps their existing one-chip-per-label behavior.
    | { kind: "progress"; label: string; done: boolean; group?: string }
    | { kind: "step"; step: OnboardingStep; payload: unknown }
    // Incremental live feedback while the profiles step's discovery runs —
    // fired the instant a candidate clears validation, ahead of the terminal
    // `step` event. Additive only: the terminal `step` event's payload still
    // carries the complete candidate list (the source of truth for a page
    // reload/resume), so a client that ignores `candidate` entirely still
    // renders correctly, just without the live-discovery feel.
    | { kind: "candidate"; profile: DiscoveredProfile }
    // Platforms where discovery found MORE THAN ONE account that survived every
    // check, so there is a real question to put to the artist: which of these
    // is yours? `chosen` is what the build actually wrote (the primary — tiers
    // run in authority order); `options` is every candidate including it.
    //
    // The auto-build cannot ask, because nobody is watching it. It writes the
    // primary so the page is complete, and sends the alternatives here for the
    // client to raise once the artist is looking. Held in memory only: if they
    // leave before answering, the primary stands and nothing is broken — the
    // artist is never left with an empty platform waiting on a question.
    | { kind: "choices"; platform: string; chosen: string; options: DiscoveredProfile[] }
    // `sources` is the numbered citation manifest ([n] markers in `doc`/`about`
    // resolve into this list) narrowed to just the ids either text actually
    // cites — see extractCitedIds. Empty when nothing was citable.
    // `stage` splits what used to be one step into the order the artist actually
    // needs it in: read and correct the knowledge document FIRST, decide about the
    // About second. At `stage: "doc"` there is no About yet and `about` is null.
    | { kind: "draft"; stage: "doc" | "about"; doc: string; about: string | null; sources: DocSource[]; selfWrite?: boolean }
    | { kind: "complete" }
    | { kind: "error"; message: string };

export type ClientTurn =
    | { type: "open" }
    | { type: "confirm_profiles"; addedLinks: { url: string }[]; removedSiteNames: string[] }
    // "Look for more" on the profiles card. Discovery is bounded and drops its later
    // tiers on a slow run, so two runs for the same artist can return different numbers
    // of profiles. Re-runs the search with a fresh budget rather than leaving the artist
    // to wonder whether that was everything.
    // Carries the SAME decisions as confirm_profiles. Re-searching must not cost
    // the artist the confirmations and removals they have already made — see
    // applyProfileLinkDecisions. Optional so an older client still works.
    | { type: "find_more_profiles"; addedLinks?: { url: string }[]; removedSiteNames?: string[] }
    | { type: "vault_review"; decisions: { sourceId: string; status: "approved" | "rejected" }[]; addedUrls: string[] }
    // `question` is the stateless round-trip of the question TEXT the client
    // was actually shown (same pattern as `publish`'s doc/about — see
    // resolveInterviewQuestionText below for why grounded questions need
    // this while static ones don't).
    | { type: "interview_answer"; questionKey: string; answer: string | null; question?: string }
    // `sources` round-trips the draft event's citation manifest (spec §6 stateless-turn
    // pattern, same as doc/about) — optional/omittable so a stale client that doesn't
    // know about citations yet still publishes successfully, just without a manifest.
    // The artist has read (and possibly corrected) the knowledge document and is
    // choosing how their About gets written. `doc` round-trips their corrections
    // back — everything downstream is generated from the version they approved,
    // not the version we generated.
    | { type: "about_choice"; mode: "generate" | "self"; doc: string; sources?: DocSource[] }
    | { type: "publish"; doc: string; about: string; sources?: DocSource[] };

/** How long the vault step waits for web discovery.
 *
 *  Was 25s, which a measured run overran: a grounded Gemini search (~12-33s) plus
 *  the verification fetches that now gate every candidate came to ~38s. The turn
 *  returned an empty vault and told the artist we "didn't find much about you on
 *  the web" — while the search was still running. It then inserted four sources
 *  after they had already moved past the step, where nothing would ever show them.
 *
 *  45s fits inside the route's 55s turn deadline with room to spare, and the step
 *  can afford it now that the two publish-step Gemini calls no longer share one
 *  turn. The wait is narrated by a progress chip rather than being dead air. */
const VAULT_DISCOVERY_BUDGET_MS = 45_000;

/** How long the interview step will wait for a background Instagram ingest to
 *  land before giving up and asking static questions instead.
 *
 *  The ingest starts when profiles are confirmed, two steps earlier, so it has
 *  the whole vault step (45s of discovery plus however long the artist spends
 *  curating) to finish. This is the last-resort top-up for a run that is nearly
 *  done — NOT the main mechanism. Kept short because the artist is watching a
 *  spinner, and a miss costs only the grounded questions, which is exactly what
 *  happens today. */
const SOCIAL_INGEST_WAIT_MS = 8_000;

/** Runs work after the response has flushed.
 *
 *  Next's `after()` is the only mechanism Vercel guarantees will still execute
 *  once a serverless response is sent — a bare floating promise can be frozen,
 *  which is the known gap that makes the About flow's self-heal unreliable
 *  (see MEMORY.md). Falls back to a floating promise outside a request scope
 *  (tests, scripts) where `after()` throws.
 *
 *  Never let background failure surface to the artist: this is best-effort by
 *  construction. */
function runAfterResponse(label: string, work: () => Promise<unknown>): void {
    const guarded = () => work().catch(e => console.error(`[onboarding] ${label} failed:`, e));
    try {
        after(guarded);
    } catch {
        void guarded();
    }
}

const NARRATION = {
    building: "Your profile is yours. Building your page now, which takes a moment.",
    built: "Done. Your page is live below. You can edit anything on it, and take off anything that isn't you.",
    builtThin: "Done, though I didn't find much about you online yet. Your page is live below. Add a link or two and I'll have more to work with.",
    welcome: "Welcome! Your profile is officially yours — let's get it into shape. This takes about two minutes, and you can pick it back up anytime.",
    welcomeBack: "Welcome back — picking up right where you left off.",
    alreadyDone: "You're all set — your profile is published. You can edit anything from your page whenever you like.",
    profiles: "First: here's everything we have linked to you. Leaving a card as-is confirms it — remove anything that isn't you, or paste a profile we missed. Press and interviews come next.",
    profilesEmpty: "Let's start with where people can find you. Paste your Spotify, Instagram, or anywhere else you live online — or skip ahead and add them later.",
    // Says they're already added, because they now are. The old copy — "confirm
    // the ones that are yours" — described an opt-in list sitting under a card
    // whose first line promised "leaving a card as-is confirms it". An artist
    // followed the first line and lost every discovered profile.
    profilesCandidatesFound: (count: number) =>
        `I also found ${count} more ${pluralize(count, "profile", "profiles")} by searching the web and added ${pluralize(count, "it", "them")} below — remove anything that isn't you.`,
    profilesDone: "Profiles confirmed. Now let's look at what the internet says about you.",
    // Names what to ADD, not just what to keep. The empty variant below always
    // did; this one didn't, so an artist who had sources found was never told
    // this was the step for press. A real artist read the earlier "paste a link
    // we missed" as profiles-only (correctly), never realised publications were
    // wanted, and an article written about him went uncollected — the run then
    // surfaced no press at all. Also drops "the AI" for what it actually does.
    vault: (count: number) =>
        `We found ${count} ${pluralize(count, "source", "sources")} about you. Keep what's accurate, and add anything we missed — press, interviews, features, your own site. These feed your About and the answers your page gives fans.`,
    vaultEmpty: "We didn't find much about you on the web yet — no problem. Paste anything written about you below — press, an interview, a feature, your own site — or just continue.",
    vaultDone: "Sources sorted. Now the fun part — three quick questions. Skip any of them.",
    generating: "Okay, I have everything I need — building your knowledge document now from your links, your sources, and your own answers.",
    docReady: "Here's your knowledge document. It's the record everything else is built from — your About, your page's Q&A, your fun facts — so it's worth reading closely. Check the claims against the sources and fix anything I got wrong.",
    writingAbout: "Writing your About from the document.",
    selfWrite: "All yours — write it however you want. The document stays as your knowledge base either way.",
    draftReady: "Your About is ready. Publish it as-is, or edit it first — your call.",
    published: "You're live! Your About is published, and everything you shared is saved as your artist doc — it now powers your page's Q&A and fun facts too.",
} as const;

// --- interview: grounded questions first, static bank as fallback/filler --

/** Interview budget: at most 3 questions total per onboarding, combining
 *  grounded (social-signal-backed) questions with the static fallback bank.
 *  Everything beyond this belongs to the future follow-up email cadence, not
 *  the claim-time interview. */
const INTERVIEW_QUESTION_CAP = 3;

/** Defensive cap on a client-echoed grounded question's text (see
 *  resolveInterviewQuestionText) — these are always one short spoken
 *  sentence in practice. */
const MAX_CLIENT_QUESTION_CHARS = 500;

interface InterviewQuestionCandidate {
    key: string;
    question: string;
    sourceUrls: string[];
}

/** Builds the interview's up-to-3-question list: grounded (social-signal-
 *  backed) questions first, static ONBOARDING_QUESTIONS filling any
 *  remaining slots up to INTERVIEW_QUESTION_CAP. `generateGroundedQuestions`
 *  already never throws on its own (it degrades to `[]` on any failure —
 *  missing posts, Gemini down, malformed output), but this is wrapped again
 *  defensively: the interview must never break because Apify/Gemini had a
 *  bad day. */
async function buildInterviewQuestions(artistId: string): Promise<InterviewQuestionCandidate[]> {
    let grounded: GroundedQuestion[] = [];
    try {
        // The ingest kicked off at confirm_profiles may still be in flight.
        // Bounded top-up, not the main mechanism — see SOCIAL_INGEST_WAIT_MS.
        const havePosts = await waitForSocialPosts(artistId, SOCIAL_INGEST_WAIT_MS);
        if (!havePosts) {
            // Deliberately loud. An empty grounded-question list used to be
            // indistinguishable from "we looked and nothing was interesting",
            // which is how this shipped broken to a real artist.
            console.warn(`[onboarding] no social posts for ${artistId} — interview falls back to static questions`);
        }
        grounded = await generateGroundedQuestions(artistId, { max: INTERVIEW_QUESTION_CAP });
        if (havePosts && grounded.length === 0) {
            console.warn(`[onboarding] posts exist for ${artistId} but no grounded questions cleared the bar`);
        }
    } catch (e) {
        console.error("[onboarding] generateGroundedQuestions failed:", e);
    }
    const groundedCandidates: InterviewQuestionCandidate[] = grounded.map(g => ({ key: g.key, question: g.question, sourceUrls: g.sourceUrls }));
    const groundedKeys = new Set(groundedCandidates.map(g => g.key));
    const staticCandidates: InterviewQuestionCandidate[] = ONBOARDING_QUESTIONS
        .filter(q => !groundedKeys.has(q.key)) // defensive: the two key spaces never actually collide
        .map(q => ({ key: q.key, question: q.question, sourceUrls: [] }));
    return [...groundedCandidates, ...staticCandidates].slice(0, INTERVIEW_QUESTION_CAP);
}

/** Resolves the human-readable question text to store for an
 *  `interview_answer` turn. A static key is looked up against the fixed
 *  ONBOARDING_QUESTIONS bank server-side — the client-sent `question` is
 *  ignored for these, exactly as before this feature existed. A grounded key
 *  (the GROUNDED_QUESTION_KEY_PREFIX from questionGenerator.ts) has no fixed
 *  bank to validate against — regenerating just to look up its text would
 *  cost another ~12s Gemini call on every "Send" click, so its text is
 *  trusted from the client instead, the same stateless round-trip `publish`
 *  already uses for doc/about. This route is gated by `canEditArtist`, so at
 *  most an artist can affect their OWN artist_interview_answers row this way
 *  — nothing they can't already do via the vault/paste inputs. Returns null
 *  when the key matches neither shape (a stale/garbage key). */
function resolveInterviewQuestionText(questionKey: string, clientQuestion: string | undefined): string | null {
    const staticQuestion = ONBOARDING_QUESTIONS.find(q => q.key === questionKey);
    if (staticQuestion) return staticQuestion.question;
    if (questionKey.startsWith(GROUNDED_QUESTION_KEY_PREFIX)) {
        const text = typeof clientQuestion === "string" ? clientQuestion.trim().slice(0, MAX_CLIENT_QUESTION_CHARS) : "";
        return text || null;
    }
    return null;
}

// Even with thinking off the race can still be lost — rotate by question
// index so a run of misses never repeats the same line in one interview.
const ACK_FALLBACKS = [
    "Love that — noted, in your words.",
    "Got it — that's in, just how you put it.",
    "Appreciate you sharing that — saved, word for word.",
    "Noted — thanks for putting that so plainly.",
];

/** Trust-breaking defect (product-owner-caught, see
 *  `.superpowers/sdd/2026-08-17-post-claim-onboarding/signal-integrity-report.md`):
 *  when an artist disputed a question built from a mismatched post citation,
 *  the ack replied "I must have misremembered" — claiming a memory the model
 *  doesn't have and effectively confessing to inventing the question, at the
 *  exact moment credibility matters most. The system prompt below forbids
 *  this class of language; this blocklist is the structural backstop — if a
 *  model response slips past the prompt anyway, it is replaced with the
 *  rotating fallback rather than ever reaching the artist. Case-insensitive,
 *  matched as substrings so punctuation/casing variants still get caught. */
const ACK_MEMORY_OR_APOLOGY_BLOCKLIST = [
    "misremembered", "i remember", "my apologies", "i thought", "sorry",
];

function containsMemoryOrApologyLanguage(text: string): boolean {
    const lower = text.toLowerCase();
    return ACK_MEMORY_OR_APOLOGY_BLOCKLIST.some(phrase => lower.includes(phrase));
}

/** One warm Gemini sentence reacting to an interview answer. Bounded at 5s;
 *  any failure — timeout, error, or a response that reads as claiming memory
 *  or apologizing/admitting fault (see ACK_MEMORY_OR_APOLOGY_BLOCKLIST) —
 *  falls back to a rotating template. The ack is garnish, never a blocker,
 *  and never a place for the model to claim it "remembered" or "misremembered"
 *  anything: it has no memory, and a challenged question came from a real
 *  linked post, not from thin air. `questionIndex` (0-based position of this
 *  question within the interview) selects the fallback variant so a run of
 *  failures never repeats. */
async function generateInterviewAck(question: string, answer: string, questionIndex: number): Promise<string> {
    const fallback = ACK_FALLBACKS[questionIndex % ACK_FALLBACKS.length];
    try {
        const response = await Promise.race([
            getGemini().models.generateContent({
                model: GEMINI_MODEL_FLASH,
                contents: `The artist was asked: "${question}" and answered: "${answer}".

Reply with ONE short, spoken sentence reacting to their answer. Rules:
- If the answer disputes the question, says it doesn't match anything they posted, or reads as confused about where it came from: acknowledge briefly and plainly, make clear the question came from a specific linked post rather than being made up, and move on. One short sentence, no grovelling.
- Otherwise, react warmly and specifically to the substance of what they said.
- Never claim memory, recall, or a feeling about the question itself — no "I remember", "I thought", "I must have misremembered", or similar. You have no memory; every question is generated fresh from real data.
- Never apologize for or admit to being wrong, mistaken, or making something up, and never speculate about why the question might have been off.
- No questions, no emoji, no hype words.`,
                // Thinking defaults ON for gemini-2.5-flash and burns ~1.5s+ on a
                // one-line reply — enough to lose this 5s race. Off ONLY here.
                config: { temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } },
            }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("ack timeout")), 5000)),
        ]);
        const text = response.text?.trim();
        if (!text || containsMemoryOrApologyLanguage(text)) return fallback;
        return text;
    } catch {
        return fallback;
    }
}

// --- confirm_profiles failure messaging (Bug 3) -------------------------
// Two distinct failure causes need distinct copy: a link we couldn't even
// parse (no username/profile path) vs. a link we understood but the DB
// write rejected (e.g. a unique-constraint collision — already linked to
// another profile). Conflating them as "unrecognized" is misleading in the
// second case, so each gets its own message naming the offending link(s).
//
// A URL that fails platform extraction is no longer assumed unrecognized —
// see the confirm_profiles handler's addedLinks loop, which tries it as a
// vault source (an artist's own website) before giving up. Only a link that
// ALSO fails to resolve to a real page still reaches buildUnrecognizedLinksMessage.

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

/** extractArtistId returned nothing AND the URL also failed to resolve to a
 *  real page (dead link, unsafe, or no usable metadata) — see the addedLinks
 *  loop, which tries a fetchable non-platform URL as a vault source first.
 *  Keeps the phrase "couldn't recognize" for backward compatibility with
 *  earlier copy, while now naming the offending link(s) and explaining why.
 *
 *  The closing line is hedged ("if it's on a platform we support") rather
 *  than asserting Links can hold it: urlmap has no generic website
 *  platform (only `linktree`), so that used to be flatly wrong advice for
 *  anything that isn't a supported platform — a bare `instagram.com` (no
 *  username) genuinely can be added from Links, but a dead personal
 *  domain can't, and the copy must not promise otherwise.
 *
 *  `blocked` must match what actually happens next: when the step is about
 *  to be re-emitted for a retry (Bug 2's all-failed path) the closing line
 *  invites a paste; when the step is confirming and advancing to vault
 *  instead, inviting a paste right before "Profiles confirmed" would be a
 *  message that doesn't match reality — so it points to Links later. */
function buildUnrecognizedLinksMessage(urls: string[], blocked: boolean): string {
    const list = formatFailedLinkList(urls);
    const noun = pluralize(urls.length, "one of your links", `${urls.length} of your links`);
    const subject = urls.length === 1 ? "It" : "They";
    const verb = pluralize(urls.length, "doesn't", "don't");
    const linkNoun = pluralize(urls.length, "a direct profile link", "direct profile links");
    const tail = blocked
        ? "paste the profile URL and I'll try again."
        : `if it's on a platform we support, you can add ${pluralize(urls.length, "it", "them")} anytime from the Links section of your page.`;
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
        : "you can try again anytime from the Links section of your page, or reach out if that seems wrong.";
    return `Heads up — I couldn't save ${noun}: ${list}. Looks like ${pronoun} already linked to another profile on Music Nerd — ${tail}`;
}

/** A pasted link that isn't a recognized platform profile but resolved to a
 *  real page whose title carries the artist's own name — routed to the vault
 *  as `approved` instead of rejected (the personal-website fix: urlmap has
 *  no generic platform for an artist's own domain, so rejecting it outright
 *  would throw away the best About source an artist can hand us). Only this
 *  branch is allowed to claim "it looks like your site" — that claim is
 *  exactly the evidence buildRoutedToVaultPendingMessage's URLs lack. One
 *  short, plain line — no showmanship. */
function buildRoutedToVaultOwnedMessage(urls: string[]): string {
    const list = formatFailedLinkList(urls);
    const subject = pluralize(urls.length, "That's not a platform profile", "Those aren't platform profiles");
    const rest = pluralize(urls.length, "it looks like your site", "they look like your own sites");
    const pronoun = pluralize(urls.length, "it", "them");
    const noun = pluralize(urls.length, "a source", "sources");
    return `${subject}: ${list} — but ${rest}, so I've added ${pronoun} as ${noun} for your About.`;
}

/** Same routing as buildRoutedToVaultOwnedMessage, but the page's title
 *  didn't carry the artist's name — added as `pending` for curation at the
 *  vault step (next) rather than approved outright, so the copy must not
 *  assert ownership it doesn't have evidence for. */
function buildRoutedToVaultPendingMessage(urls: string[]): string {
    const list = formatFailedLinkList(urls);
    const subject = pluralize(urls.length, "That's not a platform profile", "Those aren't platform profiles");
    const pronoun = pluralize(urls.length, "it", "them");
    const noun = pluralize(urls.length, "a possible source", "possible sources");
    const verb = pluralize(urls.length, "it's", "they're");
    return `${subject}: ${list} — I've added ${pronoun} as ${noun} for your About; you'll get to confirm ${verb} accurate in a moment.`;
}

/** extractArtistId found nothing, the URL resolved to a real page, but the
 *  vault insert itself threw (a genuine DB failure). Distinct from
 *  buildUnrecognizedLinksMessage — the link WAS recognized as a real page,
 *  so calling it unrecognized would misreport what actually went wrong. */
function buildVaultInsertFailedMessage(urls: string[]): string {
    const list = formatFailedLinkList(urls);
    const noun = pluralize(urls.length, "one of your links", `${urls.length} of your links`);
    const pronoun = pluralize(urls.length, "it", "them");
    const sourceNoun = pluralize(urls.length, "a source", "sources");
    return `Heads up — I couldn't save ${noun} as ${sourceNoun} for your About: ${list}. Try again in a moment, or add ${pronoun} later from the vault step.`;
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
async function* emitStep(artistId: string, step: OnboardingStep, discoverProfiles = false, forceVaultDiscovery = false): AsyncGenerator<TurnEvent> {
    switch (step) {
        case "profiles": {
            yield { kind: "progress", label: "Gathering your profiles", done: false };
            const payload = await buildProfilesPayload(artistId);
            yield { kind: "progress", label: "Gathering your profiles", done: true };

            // Streamed live: every validated candidate renders the instant
            // it's found — never a silent wait followed by one batch dump.
            // The many per-platform "searching" events (up to ~9 platforms
            // across 4 tiers, out of order, sometimes repeated as confirmed
            // handles propagate) collapse into ONE PROFILE_SEARCH_GROUP
            // progress line that just names how many DISTINCT platforms have
            // been searched so far — deduped by the raw `platform` key (a
            // repeat "searching" for a platform already in `seenPlatforms`
            // emits nothing, so it can never double-count). That line only
            // ever flips to `done` ONCE, after the generator is fully
            // exhausted (success or failure) — the one unambiguous "every
            // platform has been checked" signal. It is deliberately never
            // inferred from "no platform is currently in flight", since that
            // condition is also briefly true between tiers and would flicker
            // the line between searching/done and back. The generator itself
            // never throws (profileDiscovery.ts's contract), but the
            // try/catch here is defense-in-depth so a bug in the stream can't
            // take down the whole `profiles` turn — and the closing progress
            // line below still fires afterward either way, so the UI always
            // settles instead of being left mid-search forever.
            const candidates: DiscoveredProfile[] = [];
            /** Platforms that turned the probe away rather than answering it —
             *  carried into the payload so the card can say "couldn't check"
             *  instead of listing them as missing. */
            const unreachable: string[] = [];
            if (discoverProfiles) {
                const seenPlatforms = new Set<string>();
                try {
                    for await (const event of discoverArtistProfilesStream(artistId)) {
                        switch (event.kind) {
                            case "searching":
                                if (!seenPlatforms.has(event.platform)) {
                                    seenPlatforms.add(event.platform);
                                    yield {
                                        kind: "progress",
                                        label: `Searching ${seenPlatforms.size} platform${seenPlatforms.size === 1 ? "" : "s"}…`,
                                        done: false,
                                        group: PROFILE_SEARCH_GROUP,
                                    };
                                }
                                break;
                            case "found":
                                candidates.push(event.profile);
                                yield { kind: "candidate", profile: event.profile };
                                break;
                            case "unreachable":
                                unreachable.push(event.platform);
                                break;
                        }
                    }
                } catch (e) {
                    console.error("[onboarding] profile discovery stream failed:", e);
                }
                if (seenPlatforms.size > 0) {
                    yield {
                        kind: "progress",
                        label: `Searched ${seenPlatforms.size} platform${seenPlatforms.size === 1 ? "" : "s"}`,
                        done: true,
                        group: PROFILE_SEARCH_GROUP,
                    };
                }
            }

            const baseNarration = payload.links.length > 0 ? NARRATION.profiles : NARRATION.profilesEmpty;
            const narration = candidates.length > 0
                ? `${baseNarration} ${NARRATION.profilesCandidatesFound(candidates.length)}`
                : baseNarration;
            yield { kind: "chat", text: narration };
            yield { kind: "step", step: "profiles", payload: { ...payload, candidates, unreachable } };
            return;
        }
        case "vault": {
            let pending = await getVaultSourcesByArtistId(artistId, "pending");
            if (forceVaultDiscovery || pending.length === 0) {
                // Approval-time discovery may have found nothing or still be running.
                // Re-run when the vault is entirely empty (spec §4) — OR when this
                // is the fresh profiles→vault transition and confirm_profiles just
                // routed the artist's own website in as a bonus vault source
                // (forceVaultDiscovery, set exactly once on that one transition).
                // That source is a gift from the artist, not "the internet's take"
                // on them, and must never be mistaken for "nothing left to search
                // for" — see the website-to-vault fix's Notes on profiles→vault.
                // Capped at 25s; on timeout `pending` stays as-is and the
                // vaultEmpty degrade path runs if it's still empty.
                // Only WEB-DISCOVERED sources count as evidence the web has already
                // been searched. An uploaded file (or the artist's own site) is a
                // gift from the artist, not the internet's take on them — the same
                // reasoning the forceVaultDiscovery comment above makes. Counting an
                // upload here silently suppressed discovery entirely for any artist
                // who had one, which is how a re-run surfaced an empty vault.
                const approved = (await getVaultSourcesByArtistId(artistId, "approved"))
                    .filter(s => !s.filePath);
                if (forceVaultDiscovery || approved.length === 0) {
                    yield { kind: "progress", label: "Searching the web for sources about you", done: false };
                    try {
                        await Promise.race([
                            searchAndPopulateVault(artistId, { deadline: Date.now() + VAULT_DISCOVERY_BUDGET_MS }),
                            new Promise(resolve => setTimeout(resolve, VAULT_DISCOVERY_BUDGET_MS)),
                        ]);
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
                // `verified` travels with each source so the card can say plainly
                // which ones we actually read. An unverified source is still shown
                // and still clickable — the artist is the best judge of whether a
                // link about them is real — it just carries no implication that its
                // description was checked against the page.
                payload: {
                    sources: pending.map(s => ({
                        id: s.id,
                        title: s.title,
                        url: s.url,
                        snippet: s.snippet,
                        ogImage: s.ogImage ?? null,
                        verified: isCitableSource(s),
                    })),
                },
            };
            return;
        }
        case "interview": {
            const asked = new Set((await getInterviewAnswers(artistId) ?? []).map(a => a.questionKey));
            // Once INTERVIEW_QUESTION_CAP distinct questions have been asked
            // (answered or skipped — both count), there is nothing left to
            // offer regardless of what a regeneration might return, so skip
            // straight past it rather than paying another ~12s Gemini call
            // just to find that out.
            let questions: InterviewQuestionCandidate[] = [];
            if (asked.size < INTERVIEW_QUESTION_CAP) {
                // Grounded generation reads the artist's ingested Instagram
                // posts and, when there are any, makes a real Gemini call —
                // the ~12s this can take is real work, not a stall, so it's
                // narrated plainly rather than left as dead air.
                yield { kind: "progress", label: "Reading your posts", done: false };
                questions = await buildInterviewQuestions(artistId);
                yield { kind: "progress", label: "Reading your posts", done: true };
            }
            // "number" is derived from how many questions have already been
            // asked, NOT from array position — a regeneration can legitimately
            // reorder/replace not-yet-asked candidates turn to turn, and the
            // progress indicator must stay monotonic regardless.
            const next = questions.find(q => !asked.has(q.key));
            if (!next) {
                await confirmOnboardingStep(artistId, "interview");
                yield* emitStep(artistId, "publish");
                return;
            }
            yield { kind: "chat", text: next.question };
            yield {
                kind: "step",
                step: "interview",
                payload: {
                    questionKey: next.key, question: next.question,
                    number: asked.size + 1, total: INTERVIEW_QUESTION_CAP,
                    sourceUrls: next.sourceUrls,
                },
            };
            return;
        }
        case "publish": {
            // STAGE 1 of the publish step: build the knowledge document and hand it
            // over to be read. The About is NOT written yet.
            //
            // It used to be written here, in the same turn, and shown alongside the
            // document — which put the artist in the position of approving prose
            // generated from a record they hadn't checked. The document is the thing
            // claims can actually be verified against, so it comes first and on its
            // own; the About is generated afterwards, from whatever version of the
            // document the artist approved. (It also means neither Gemini call has
            // to share one turn's deadline with the other.)
            yield { kind: "chat", text: NARRATION.generating };
            yield { kind: "progress", label: "Reading your sources and answers", done: false };
            const publishStartedAt = Date.now();
            const sources = await buildDocSources(artistId);
            // Gemini failure policy: apologize in-stream, retry ONCE, else fall back
            // to the lighter non-cited synthesis rather than dead-ending the turn.
            // The retry is skipped once we're already past budget so the worst case
            // fits `maxDuration` (see PUBLISH_RETRY_BUDGET_MS above).
            let doc: string | null = null;
            try {
                doc = await synthesizeArtistDoc(artistId, sources);
            } catch (e) {
                if (Date.now() - publishStartedAt > PUBLISH_RETRY_BUDGET_MS) throw e;
                yield { kind: "chat", text: "Hmm, that didn't come together — give me one more second." };
                try {
                    doc = await synthesizeArtistDoc(artistId, sources);
                } catch (e2) {
                    console.error("[onboarding/publish] doc retry also failed, falling back:", e2);
                }
            }
            if (doc === null) {
                yield { kind: "chat", text: "Let's go with a simpler version for now." };
                const artist = await getArtistById(artistId);
                const fallback = await synthesizeFallbackAbout(artistId, artist?.name ?? "this artist", undefined, sources);
                doc = `## Overview\n${fallback}`;
            }
            yield { kind: "progress", label: "Reading your sources and answers", done: true };
            // Narrow the manifest to ids the doc actually cites — a source built into
            // the candidate list but never referenced shouldn't show up as a numbered
            // reference with nothing pointing to it.
            const docSources = sources.filter(s => extractCitedIds(doc as string).has(s.id));
            // Turns are stateless: the doc round-trips through the client and comes
            // back on the next turn (spec §6, advisor FIX 1) — carrying any
            // corrections the artist made to it.
            yield { kind: "chat", text: NARRATION.docReady };
            yield { kind: "draft", stage: "doc", doc, about: null, sources: docSources };
            return;
        }
    }
}

/** What applying an artist's profile-card decisions produced, bucketed by what
 *  went wrong — each bucket gets different copy (see the build*Message helpers). */
interface ProfileLinkOutcome {
    /** siteNames actually written to the artist's row. The auto-build needs
     *  this to tell the vault search which columns hold a discovery GUESS:
     *  intersecting what discovery proposed with what survived the identity
     *  guards, rather than assuming every proposal landed. */
    written: string[];
    /** Recognised as a platform profile and refused because we could not prove
     *  it belongs to this artist. Distinct from `writeRejected`, which is a
     *  database failure — this one is a judgement. */
    identityBlocked: string[];
    unrecognized: string[];
    writeRejected: string[];
    routedToVaultApproved: string[];
    routedToVaultPending: string[];
    vaultInsertFailed: string[];
}

/**
 * Saves the artist's decisions from the profiles card: clear what they removed,
 * add what they kept or pasted, route a non-platform URL to the vault.
 *
 * Shared by `confirm_profiles` AND `find_more_profiles`. That sharing is the
 * point: "Look for more" used to send NO payload, so every confirmation and
 * removal the artist had made was discarded, the card re-rendered from server
 * state, and their own profiles came back as fresh unconfirmed candidates —
 * seen happening to a real artist. The card's own copy promises "leaving a card
 * as-is confirms it", so re-searching has to honour that promise too.
 *
 * Only `confirm_profiles` advances the step; this function never does.
 */
/** Exported so the benchmark can run the same sequence onboarding does —
 *  discover, then write, then search for sources. It used to run only the last
 *  of those and was quoted as the product's score. */
export async function applyProfileLinkDecisions(
    artistId: string,
    addedLinks: { url: string }[],
    removedSiteNames: string[],
    /**
     * Check that each handle really belongs to this artist before writing it.
     *
     * OFF BY DEFAULT, and the default is the point: two of the three callers
     * pass links the ARTIST typed, and an artist adding their own Instagram
     * must not be blocked because somebody with a similar name is also in the
     * directory. Only the auto-build — which writes whatever profile discovery
     * guessed, with nobody looking — turns this on.
     */
    opts?: { verifyIdentity?: boolean },
): Promise<ProfileLinkOutcome> {
    for (const siteName of removedSiteNames) {
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
    // A URL that doesn't extract to any platform (an artist's own
    // website, most commonly — urlmap has no generic website platform)
    // routed to the vault instead of rejected. Split by ownership
    // confidence — the two get different copy below (buildRoutedToVault*),
    // since only the approved bucket has any evidence it's the artist's
    // own page.
    const routedToVaultApproved: string[] = [];
    const routedToVaultPending: string[] = [];
    // The write succeeded (recognized fine) but the vault insert itself
    // threw — a real DB failure, not an "unrecognized" link. Distinct
    // bucket so the copy doesn't misreport what actually went wrong.
    const vaultInsertFailed: string[] = [];
    /** Recognised fine, and refused because we could not prove it is theirs. */
    const identityBlocked: string[] = [];
    const written: string[] = [];
    // Only needed for the ownership cross-check below, which no
    // platform-recognized URL ever reaches — fetched at most once, so a
    // turn with no failed-extraction URLs never pays for it.
    let artistName: string | undefined;
    // Idempotency: a reconnect can resubmit the exact same addedLinks
    // (spec §9 — every handler upserts and continues, never double-acts).
    // setArtistLink/clearArtistLink are naturally idempotent (same column,
    // same value); a plain insertVaultSource is not, so URLs already in
    // the vault (from an earlier attempt at this exact turn, or a
    // duplicate paste) are looked up once and skipped rather than
    // re-inserted as a second row.
    let existingVaultStatusByUrl: Map<string, string> | undefined;
    for (const raw of addedLinks) {
        let extracted;
        try {
            extracted = await extractArtistId(raw.url);
        } catch (e) {
            console.error(`[onboarding] extractArtistId failed for ${raw.url}:`, e);
            unrecognized.push(raw.url);
            continue;
        }
        if (!extracted?.siteName || !extracted?.id) {
            // Not a recognized platform profile. Before rejecting it, see
            // if it's a real page we can route to the vault instead — the
            // single best About source an artist can hand us (their own
            // site) has nowhere to go in urlmap and must not be thrown
            // away just because it isn't a platform profile.
            if (isUnsafeUrl(raw.url)) {
                unrecognized.push(raw.url);
                continue;
            }
            if (existingVaultStatusByUrl === undefined) {
                const existing = await getVaultSourcesByArtistId(artistId);
                existingVaultStatusByUrl = new Map(existing.map(s => [s.url, s.status]));
            }
            const existingStatus = existingVaultStatusByUrl.get(raw.url);
            if (existingStatus) {
                // Already routed to the vault (an earlier attempt at this
                // turn, or a duplicate paste) — idempotent no-op, not a
                // fresh insert or a fetch.
                (existingStatus === "approved" ? routedToVaultApproved : routedToVaultPending).push(raw.url);
                continue;
            }
            const preview = await fetchLinkPreview(raw.url);
            if (!preview.title && !preview.imageUrl) {
                // Dead link / no metadata to go on — genuinely unrecognized.
                unrecognized.push(raw.url);
                continue;
            }
            // Resolves to a real page. Confidence on ownership: does the
            // page's own title carry the artist's name? If so, it's
            // authoritative and self-authored — the artist just handed it
            // to us — so approve it outright. Otherwise park it as
            // `pending` for curation at the vault step, same as any other
            // web-found source. Reuses the same name cross-check the
            // handle-probing tier uses (`titleMatchesArtist`) rather than
            // a second matcher.
            if (artistName === undefined) artistName = (await getArtistById(artistId))?.name ?? "";
            const ownedByArtist = !!preview.title && titleMatchesArtist(preview.title, artistName);
            try {
                const source = await insertVaultSource({
                    artistId,
                    url: raw.url,
                    title: preview.title ?? undefined,
                    // `ownedByArtist` means the artist handed us this URL AND
                    // the page's own title carries their name — that is the
                    // artist's official site, so record it as such instead of
                    // discarding the signal. inferTypeFromUrl can't determine
                    // this (a URL alone never says who owns it) and would call
                    // a personal domain an "article", indistinguishable from a
                    // magazine piece about them. The profile surfaces approved
                    // "website" sources beside Links rather than burying them.
                    type: ownedByArtist ? "website" : inferTypeFromUrl(raw.url),
                    status: ownedByArtist ? "approved" : "pending",
                });
                existingVaultStatusByUrl.set(raw.url, ownedByArtist ? "approved" : "pending");
                // Fire-and-forget content enrichment (snippet/extractedText,
                // and title too if we don't already have a good one) so doc
                // synthesis isn't left with a bare URL — mirrors the
                // vault_review addedUrls background fetch further below.
                // Title is deliberately left alone when `preview.title` is
                // already set: fetchPageContent falls back to a generic
                // "Source from <host>" title on ANY non-ok response, and
                // must never be allowed to downgrade the real og:title (e.g.
                // "Pete Rango") we already captured synchronously above.
                if (source?.id) {
                    fetchPageContent(raw.url).then(content => {
                        updateVaultSourceContent(source.id, {
                            ...(preview.title ? {} : { title: content.title }),
                            snippet: content.snippet,
                            extractedText: content.extractedText,
                            ogImage: content.ogImage,
                        }).catch(e => console.error("[onboarding] Background content update failed:", e));
                    }).catch(e => console.error("[onboarding] Background fetch failed:", e));
                }
                (ownedByArtist ? routedToVaultApproved : routedToVaultPending).push(raw.url);
            } catch (e) {
                console.error(`[onboarding] insertVaultSource failed for ${raw.url}:`, e);
                vaultInsertFailed.push(raw.url);
            }
            continue;
        }
        // THE SAME CHECKS THE VAULT PATH HAS ALWAYS APPLIED. They guarded
        // adoption from a search result and nothing else, so the auto-build —
        // the path every artist takes — wrote whatever discovery guessed. With
        // three Black Daves in this directory, that gave Black Dave another
        // one's Instagram and Black Dave MK2 a third person's. The benchmark
        // could not see it because it never ran this half of the flow.
        if (opts?.verifyIdentity) {
            if (artistName === undefined) artistName = (await getArtistById(artistId))?.name ?? "";
            const blocked =
                await nameIsAmbiguousInDirectory(artistId, artistName)
                || await handleBelongsToAnotherArtist(artistId, extracted.siteName, String(extracted.id))
                || await contradictsScrapedPosts(artistId, extracted.siteName, String(extracted.id));
            if (blocked) {
                console.log(`[onboarding] Not writing ${extracted.siteName}=${extracted.id} — identity checks did not clear it`);
                identityBlocked.push(raw.url);
                continue;
            }
        }
        try {
            await setArtistLink(artistId, extracted.siteName, extracted.id);
            written.push(extracted.siteName);
        } catch (e) {
            console.error(`[onboarding] setArtistLink failed for ${raw.url}:`, e);
            writeRejected.push(raw.url);
        }
    }

    return { unrecognized, writeRejected, routedToVaultApproved, routedToVaultPending, vaultInsertFailed, identityBlocked, written };
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

/**
 * Builds the whole page without asking the artist anything.
 *
 * The claim already established who they are — an admin approved this user on
 * this artist record — so re-asking "is this you?" proves nothing (anyone
 * claiming falsely clicks yes too) and costs a step. Carl, 2026-08-20:
 * "ideally we should create the perfect profile for them without them having to
 * do anything. That's the ideal to strive for."
 *
 * Every correction is recoverable on the profile afterwards, and the two things
 * that could genuinely go wrong are already handled upstream rather than by
 * asking:
 *   - a fabricated source can't get in (retrieval is a search API, verified)
 *   - a namesake can't be cited (requireFullName gates citability)
 *
 * Sources are auto-APPROVED, which is safe for a reason worth stating: approval
 * has never been what makes a source citable. `isCitableSource` reads
 * extractedText, which is only ever populated by machine verification. So an
 * un-curated namesake sits in the vault as a lead the artist can remove, and
 * never reaches their About.
 *
 * Failure is partial, not fatal: each stage confirms its own step, so a crash
 * mid-build leaves the artist resuming at exactly the stage that failed, using
 * the original step-by-step cards.
 */
async function* runAutoBuild(artistId: string): AsyncGenerator<TurnEvent> {
    yield { kind: "chat", text: NARRATION.building };

    // 1 — profiles
    yield { kind: "progress", label: "Finding your profiles", done: false, group: PROFILE_SEARCH_GROUP };
    const discovered: DiscoveredProfile[] = [];
    /** Platforms that refused to answer. The auto-build has no card to put a
     *  hint on, so it says so in the chat — "we found nothing there" and "they
     *  would not tell us" are different sentences and only one is true. */
    const unreachable: string[] = [];
    try {
        for await (const event of discoverArtistProfilesStream(artistId)) {
            if (event.kind === "found") {
                discovered.push(event.profile);
                yield { kind: "candidate", profile: event.profile };
            }
            if (event.kind === "unreachable") unreachable.push(event.displayName);
        }
    } catch (e) {
        console.error("[onboarding] auto-build discovery failed:", e);
    }
    /** Columns this step filled with a handle built out of the artist's NAME —
     *  the weakest thing discovery produces (see `DiscoveredProfile.provisional`).
     *  Handed to the vault search below so it treats them as still open instead
     *  of skipping them under "already have it", which is what stopped Black
     *  Dave MK2's corroborated `blackdave.xyz` from ever landing. */
    let provisionalSiteNames: string[] = [];
    const discoveredBySiteName = new Map<string, DiscoveredProfile>();
    if (discovered.length > 0) {
        // `verifyIdentity: true` — this is the ONLY caller that turns it on,
        // and the whole reason the flag exists. Nobody has looked at these
        // links: they are whatever discovery guessed, written straight to the
        // artist's row. The other two callers pass links the ARTIST typed and
        // must stay unguarded.
        //
        // The commit that added the flag claimed this line already passed it.
        // It did not — the only caller passing it was the benchmark, so the
        // guards ran in measurement and nowhere else. A guard nothing calls is
        // the exact shape of the bug it was written to fix, one level up.
        // `runAutoBuild wires the identity guards` in turnHandlers.test.ts
        // asserts this call site specifically, because a test of the guard
        // functions themselves is what let it through.
        // ONE WRITE PER PLATFORM. Discovery may now return two accounts for a
        // platform, and applyProfileLinkDecisions writes every URL it is handed
        // — so passing both made the LAST one win, which is the silent
        // arbitrary pick this whole change exists to remove. The primary is the
        // first yielded: tiers run in authority order.
        const primaries: DiscoveredProfile[] = [];
        const byPlatform = new Map<string, DiscoveredProfile[]>();
        for (const p of discovered) {
            const group = byPlatform.get(p.siteName);
            if (group) group.push(p);
            else { byPlatform.set(p.siteName, [p]); primaries.push(p); }
        }
        const outcome = await applyProfileLinkDecisions(
            artistId, primaries.map(p => ({ url: p.profileUrl })), [], { verifyIdentity: true });
        // What was WRITTEN, not what was proposed — the identity guards above
        // refuse some of it, and naming a column the vault could overwrite when
        // nothing was ever written there would be a lie in the other direction.
        const wrote = new Set(outcome.written);
        provisionalSiteNames = [...new Set(
            primaries.filter(p => p.provisional && wrote.has(p.siteName)).map(p => p.siteName),
        )];
        // Kept so the vault's answer can be compared against what discovery
        // actually wrote, once the search has run.
        for (const p of primaries) if (wrote.has(p.siteName)) discoveredBySiteName.set(p.siteName, p);
        // Only where the write actually landed. Asking "which of these two is
        // yours" about a platform whose primary the identity guards refused
        // would be offering the artist a choice we already declined to make.
        for (const [platform, options] of byPlatform) {
            if (options.length < 2 || !wrote.has(platform)) continue;
            yield { kind: "choices", platform, chosen: options[0].value, options };
        }
    }

    // The Instagram ingest and the caption extraction, on the path most artists
    // actually take.
    //
    // Both used to hang off the confirm_profiles turn only. This auto-build
    // path confirms the profiles step itself and goes straight on to build the
    // document, so a fresh claim following the primary flow never scraped a
    // feed, never populated artist_social_credits, and produced a document
    // with none of the credits or statements in it. The same class of miss as
    // the original "grounded questions only worked for hand-seeded artists",
    // one flow over.
    //
    // ENQUEUED, not run here.
    //
    // This used to call the scrape and the extraction from after(), which
    // shares this invocation's remaining maxDuration — sixty seconds against a
    // job that needs one to five minutes for the scrape alone. The platform
    // stopped it partway every time, so the credits never arrived and the
    // document written later in this same generator cited none of them.
    //
    // A job row survives the request. Slices run in /api/research/advance with
    // their own budget, driven by the client while the artist is still here and
    // by a scheduler when they are not, and the document is rebuilt once the
    // extraction finishes.
    if (unreachable.length > 0) {
        yield {
            kind: "chat",
            text: `${unreachable.join(" and ")} wouldn't let us look just now, so that's not a "no" — add ${unreachable.length === 1 ? "it" : "them"} from your page any time.`,
        };
    }
    await requestArtistResearch(artistId);
    yield {
        kind: "progress",
        label: discovered.length > 0 ? `Found ${discovered.length} profile${discovered.length === 1 ? "" : "s"}` : "Checked for your profiles",
        done: true,
        group: PROFILE_SEARCH_GROUP,
    };
    await confirmOnboardingStep(artistId, "profiles");

    // 2 — sources
    yield { kind: "progress", label: "Reading what's written about you", done: false, group: VAULT_SEARCH_GROUP };
    try {
        // Same budgeted race the vault step uses — a slow search must not hold
        // the whole build open past the route's turn deadline.
        await Promise.race([
            searchAndPopulateVault(artistId, { deadline: Date.now() + VAULT_DISCOVERY_BUDGET_MS, provisionalSiteNames }),
            new Promise(resolve => setTimeout(resolve, VAULT_DISCOVERY_BUDGET_MS)),
        ]);
    } catch (e) {
        console.error("[onboarding] auto-build source discovery failed:", e);
    }

    // THE TWO-ACCOUNT CASE THAT ACTUALLY HAPPENS.
    //
    // Grouping discovery's own output finds nothing, because discovery cannot
    // produce two candidates for one platform: tier 3 keeps the first confirmed
    // hit per platform, and `missing.delete` stops every later tier revisiting a
    // platform an earlier one resolved. The two accounts come from DIFFERENT
    // SYSTEMS — discovery guessed `blackdavemk2` from the artist's name, the
    // vault search found `blackdave.xyz` and corroborated it — and they only
    // ever meet in the artist's row.
    //
    // So the moment to ask is here: a column discovery filled with a guess, that
    // the search has since replaced with something better evidenced. Both are
    // real accounts, both were Black Dave MK2's, and picking one without asking
    // is what this whole change exists to stop.
    if (provisionalSiteNames.length > 0) {
        try {
            const after = (await getArtistById(artistId)) as unknown as Record<string, unknown> | undefined;
            const urlmapBySiteName = new Map((await getAllLinks()).map(l => [l.siteName, l]));
            for (const siteName of provisionalSiteNames) {
                const guessed = discoveredBySiteName.get(siteName);
                const now = after?.[siteName];
                if (!guessed || typeof now !== "string" || !now || now === guessed.value) continue;
                const meta = buildLinkPresentationMeta(urlmapBySiteName.get(siteName), siteName, now);
                if (!meta.profileUrl) continue;   // nothing to click through to; do not ask half a question
                yield {
                    kind: "choices",
                    platform: siteName,
                    chosen: now,
                    options: [
                        { ...guessed, value: now, profileUrl: meta.profileUrl, displayName: meta.displayName },
                        guessed,
                    ],
                };
            }
        } catch (e) {
            // Never worth failing a build over. The better-evidenced handle is
            // already written either way; the artist just is not asked.
            console.error("[onboarding] could not offer the second-account choice:", e);
        }
    }
    const pending = await getVaultSourcesByArtistId(artistId, "pending");
    for (const source of pending) {
        try {
            await updateVaultSourceStatus(source.id, "approved");
        } catch (e) {
            console.error("[onboarding] auto-approve failed:", source.id, e);
        }
    }
    const citable = pending.filter(isCitableSource).length;
    yield {
        kind: "progress",
        label: pending.length > 0 ? `Read ${pending.length} source${pending.length === 1 ? "" : "s"}` : "Looked for sources about you",
        done: true,
        group: VAULT_SEARCH_GROUP,
    };
    await confirmOnboardingStep(artistId, "vault");

    // 3 — the About. Interview answers are no longer collected here; questions
    // move to the follow-up email cadence, where they can actually be timely.
    yield { kind: "progress", label: "Writing your About", done: false, group: DOC_GROUP };
    const artist = await getArtistById(artistId);
    const artistName = artist?.name ?? "this artist";
    let wrote = false;
    try {
        const sources = await buildDocSources(artistId);
        const doc = await synthesizeArtistDoc(artistId, sources);
        const about = await generateAboutFromDoc(artistName, doc, sources);
        const cleanAbout = stripCitationMarkers(about).trim();
        if (cleanAbout) {
            const existingBio = artist?.bio;
            if (isRealBio(existingBio)) await saveBioVersion(artistId, existingBio as string);
            await upsertArtistDoc(artistId, doc);
            await upsertArtistDocSources(artistId, sources);
            await saveBioVersion(artistId, cleanAbout);
            await db.update(artists).set({ bio: cleanAbout }).where(eq(artists.id, artistId));
            wrote = true;
        }
    } catch (e) {
        console.error("[onboarding] auto-build About generation failed:", e);
    }
    yield { kind: "progress", label: wrote ? "Wrote your About" : "Couldn't write an About yet", done: true, group: DOC_GROUP };

    await confirmOnboardingStep(artistId, "interview");
    await confirmOnboardingStep(artistId, "publish");
    yield { kind: "chat", text: citable > 0 && wrote ? NARRATION.built : NARRATION.builtThin };
    yield { kind: "complete" };
}

    if (turn.type === "open") {
        if (state.complete || state.currentStep === null) {
            yield { kind: "chat", text: NARRATION.alreadyDone };
            yield { kind: "complete" };
            return;
        }
        // A fresh claim builds the page outright. A RESUME does not: the artist
        // is mid-flow because something failed or they stepped away, and the
        // step-by-step cards are the right way back in.
        if (state.currentStep === "profiles") {
            yield* runAutoBuild(artistId);
            return;
        }
        yield { kind: "chat", text: NARRATION.welcomeBack };
        yield* emitStep(artistId, state.currentStep);
        return;
    }

    if (turn.type === "find_more_profiles") {
        if (state.currentStep === null) {
            yield { kind: "chat", text: NARRATION.alreadyDone };
            yield { kind: "complete" };
            return;
        }
        if (state.currentStep !== "profiles") {
            yield { kind: "error", message: "We've already moved past your profiles — finish this step and you can edit links from your page any time." };
            yield* emitStep(artistId, state.currentStep);
            return;
        }
        // Save what the artist has already decided BEFORE re-searching. This used
        // to send nothing at all, so every confirmation and removal was discarded
        // and their own profiles came back as unconfirmed candidates — which is
        // what a real artist hit in testing. Persisting first also means the
        // re-emitted card reflects their decisions, because it reads from the
        // database rather than from client state that no longer exists.
        const findMore = await applyProfileLinkDecisions(
            artistId,
            turn.addedLinks ?? [],
            turn.removedSiteNames ?? [],
        );
        // `blocked: true` — the step is being re-emitted, so the copy should
        // invite another paste rather than point at a profile page they have
        // not reached yet.
        if (findMore.unrecognized.length > 0) yield { kind: "chat", text: buildUnrecognizedLinksMessage(findMore.unrecognized, true) };
        if (findMore.writeRejected.length > 0) yield { kind: "chat", text: buildWriteRejectedLinksMessage(findMore.writeRejected, true) };
        if (findMore.vaultInsertFailed.length > 0) yield { kind: "chat", text: buildVaultInsertFailedMessage(findMore.vaultInsertFailed) };
        yield* emitStep(artistId, "profiles", true);
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
        const { unrecognized, writeRejected, routedToVaultApproved, routedToVaultPending, vaultInsertFailed } =
            await applyProfileLinkDecisions(artistId, turn.addedLinks ?? [], turn.removedSiteNames ?? []);

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
            && unrecognized.length + writeRejected.length + vaultInsertFailed.length === (turn.addedLinks ?? []).length;

        if (submittedAdditions && allAdditionsFailed && !hasAtLeastOneLink) {
            // The user submitted links, every single one failed, and the
            // artist still has zero saved links. Do NOT confirm/advance —
            // that would show "Profiles confirmed" over an empty profile
            // (the exact bug seen in live testing). Report what went wrong
            // and re-emit the profiles step as the recovery path.
            if (unrecognized.length > 0) yield { kind: "chat", text: buildUnrecognizedLinksMessage(unrecognized, true) };
            if (writeRejected.length > 0) yield { kind: "chat", text: buildWriteRejectedLinksMessage(writeRejected, true) };
            if (vaultInsertFailed.length > 0) yield { kind: "chat", text: buildVaultInsertFailedMessage(vaultInsertFailed) };
            yield { kind: "chat", text: PROFILES_RETRY_NUDGE };
            yield* emitStep(artistId, "profiles");
            return;
        }

        await confirmOnboardingStep(artistId, "profiles");

        // Now that the artist's links are saved we know their Instagram handle,
        // and the interview (two steps later) needs their posts to ask grounded
        // questions. Kick the scrape off here so it runs during the vault step
        // instead of stalling the interview: a run takes 1-5 minutes against a
        // 55s turn deadline, so it can never be awaited inline.
        //
        // Until this existed the ingest was only ever run by hand via
        // scripts/ingest-social.ts, so grounded questions worked solely for
        // artists whose posts had been seeded manually — see
        // docs/rnd/research/2026-08-21-artist-test-pharaoh.md.
        //
        // `ensureRecentSocialPosts` is idempotent and flow-agnostic on purpose:
        // when onboarding collapses to a pre-filled profile, this call moves to
        // claim approval and nothing here needs rewriting.
        // Enqueued rather than run in after(); see runAutoBuild for why. The
        // artist is about to spend minutes on the vault step, and the client
        // advances the queue while they do.
        await requestArtistResearch(artistId);

        if (unrecognized.length > 0) yield { kind: "chat", text: buildUnrecognizedLinksMessage(unrecognized, false) };
        if (writeRejected.length > 0) yield { kind: "chat", text: buildWriteRejectedLinksMessage(writeRejected, false) };
        if (vaultInsertFailed.length > 0) yield { kind: "chat", text: buildVaultInsertFailedMessage(vaultInsertFailed) };
        if (routedToVaultApproved.length > 0) yield { kind: "chat", text: buildRoutedToVaultOwnedMessage(routedToVaultApproved) };
        if (routedToVaultPending.length > 0) yield { kind: "chat", text: buildRoutedToVaultPendingMessage(routedToVaultPending) };
        yield { kind: "chat", text: NARRATION.profilesDone };
        // Fresh profiles→vault transition — fires at most once per artist
        // (confirmOnboardingStep above permanently moves currentStep off
        // "profiles"). Force discovery whenever this turn itself dropped a
        // source into the vault, so that source can never masquerade as
        // "the vault already has everything it needs" and suppress the real
        // web search — see emitStep's vault case.
        yield* emitStep(artistId, "vault", false, routedToVaultApproved.length + routedToVaultPending.length > 0);
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
        const questionText = resolveInterviewQuestionText(turn.questionKey, turn.question);
        if (questionText === null) {
            yield { kind: "error", message: "Unknown question — let's continue from where we were." };
            yield* emitStep(artistId, "interview"); // step guard above already pinned currentStep === "interview"
            return;
        }
        const answer = turn.answer?.trim() || null;
        // Count of questions already asked BEFORE this one — its 0-based
        // position, used to pick a non-repeating ack fallback on a miss.
        const priorAnswers = await getInterviewAnswers(artistId) ?? [];
        await upsertInterviewAnswer({
            artistId,
            questionKey: turn.questionKey,
            question: questionText,
            answer,
            source: "onboarding",
        });
        if (answer) {
            yield { kind: "chat", text: await generateInterviewAck(questionText, answer, priorAnswers.length) };
        }
        // On resume, ask the first question lacking a row — answered or skipped
        // questions are never re-asked (spec §6). emitStep handles completion.
        yield* emitStep(artistId, "interview");
        return;
    }

    // STAGE 2 of the publish step: the artist has read the knowledge document and
    // is choosing how the About gets written. Reached only from a `draft` event at
    // stage "doc"; the step itself is still confirmed only by the publish turn.
    if (turn.type === "about_choice") {
        if (state.currentStep === null) {
            yield { kind: "chat", text: NARRATION.alreadyDone };
            yield { kind: "complete" };
            return;
        }
        if (state.currentStep !== "publish") {
            yield { kind: "error", message: "We're not quite there yet — let's finish the earlier steps first." };
            yield* emitStep(artistId, state.currentStep);
            return;
        }
        // The doc echoed back may carry the artist's own corrections, so it is the
        // version everything downstream is built from — but it is client-supplied,
        // so it's bounds-checked like every other echoed field.
        const doc = turn.doc?.trim();
        if (!doc || doc.length > ARTIST_DOC_MAX_CHARS) {
            yield { kind: "error", message: "That doc looks off — let me regenerate it." };
            yield* emitStep(artistId, "publish");
            return;
        }
        const sources = sanitizeDocSources(turn.sources);

        if (turn.mode === "self") {
            // No generation at all: an empty About for them to write into. Their
            // words are the point — we shouldn't put a draft in their mouth first.
            yield { kind: "chat", text: NARRATION.selfWrite };
            yield { kind: "draft", stage: "about", doc, about: "", sources, selfWrite: true };
            return;
        }

        yield { kind: "chat", text: NARRATION.writingAbout };
        yield { kind: "progress", label: "Writing your About", done: false };
        const startedAt = Date.now();
        const artist = await getArtistById(artistId);
        const artistName = artist?.name ?? "this artist";
        let about: string | null = null;
        try {
            about = await generateAboutFromDoc(artistName, doc, sources);
        } catch (e) {
            if (Date.now() - startedAt > PUBLISH_RETRY_BUDGET_MS) throw e;
            yield { kind: "chat", text: "One more try on the wording…" };
            try {
                about = await generateAboutFromDoc(artistName, doc, sources);
            } catch (e2) {
                console.error("[onboarding/about_choice] about retry also failed, falling back:", e2);
            }
        }
        if (about === null) {
            // A degraded About beats a broken one — the lighter, non-cited prompt.
            yield { kind: "chat", text: "Let's go with a simpler version for now." };
            about = await synthesizeFallbackAbout(artistId, artistName, doc, sources);
        }
        yield { kind: "progress", label: "Writing your About", done: true };
        // Both texts are shown together from here, so the manifest covers both.
        const citedIds = new Set([...extractCitedIds(doc), ...extractCitedIds(about)]);
        yield { kind: "chat", text: NARRATION.draftReady };
        yield { kind: "draft", stage: "about", doc, about, sources: sources.filter(s => citedIds.has(s.id)) };
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
        // Client-echoed, so validated defensively (same caution as decisions/
        // addedLinks/addedUrls in the route) rather than trusted as-is before
        // it lands in a stored jsonb column.
        const sources = sanitizeDocSources(turn.sources);
        // The doc keeps its [n] markers — it's shown WITH citations as its own
        // artifact. The published About does not: `artists.bio` and its version
        // history must be plain prose with no marker litter (spec: "keep the
        // public About clean"). The annotated About the artist reviewed lives
        // only in this stateless turn; its audit trail is the doc + sources
        // persisted below, which share the same citation ids.
        const cleanAbout = stripCitationMarkers(about);
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
        await upsertArtistDocSources(artistId, sources);
        await saveBioVersion(artistId, cleanAbout);
        // The ONLY implicit artists.bio write in this feature — the explicit
        // publish moment (spec §6). Later doc regens never touch the bio.
        await db.update(artists).set({ bio: cleanAbout }).where(eq(artists.id, artistId));
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
