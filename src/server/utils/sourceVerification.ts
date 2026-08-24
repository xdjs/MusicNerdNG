/**
 * Whether a vault source is something we actually READ, or something a model
 * merely TOLD us about.
 *
 * Why this module exists (product-owner-caught, twice):
 *
 *   1. An About cited the artist's SoundBetter profile for a claim about his
 *      influences. The stored `snippet` said exactly that — but `extracted_text`
 *      was empty, meaning the page was never fetched. The snippet was Gemini's
 *      own description of a search result, stored as if it were evidence and
 *      later cited as if it were verified. The live URL didn't even contain the
 *      claim.
 *   2. Several cited URLs simply did not exist: `belltower.pictures/...` (no
 *      such domain, while `belltowerpictures.com/...` is real),
 *      `rvamag.com/music/local-guitar-hero-an-interview-with-rein/` (404, while
 *      a differently-slugged article on the same site is real), five Apple Music
 *      artist IDs of which one resolved.
 *
 * Both trace to one mistake: we asked a language model to TYPE URLs and then
 * treated what it typed as retrieved data. A model asked for a URL will produce
 * a plausible one. The near-miss clusters in the database — three slug variants
 * of one article, two spellings of one domain — are the signature of guessing,
 * and in every cluster the variant that fetched successfully was the real one.
 *
 * So: fetching is the arbiter. A claim may only cite a page we retrieved and
 * read. Anything else is a lead — worth showing, worth clicking, never evidence.
 */
import type { PageContent } from "@/server/utils/fetchPageContent";

/** How a candidate source came back when we actually went and asked for it.
 *
 *  - `verified` — fetched, readable, and about this artist. Citable.
 *  - `lead` — the URL is real but we couldn't read it (bot wall, paywall,
 *    JS-only render). Shown and clickable; never cited. The artist can confirm
 *    it themselves, which is the whole point of showing it.
 *  - `dead` — the URL does not resolve or does not exist. Dropped entirely.
 */
export type SourceVerification = "verified" | "lead" | "dead";

/** Body text shorter than this is a cookie banner or a nav bar, not an article.
 *  Deliberately well above `fetchPageContent`'s 50-char floor for storing text
 *  at all: that floor decides "is there anything here", this one decides
 *  "is there enough here to base a published claim on". */
export const MIN_VERIFIED_TEXT = 400;

/** Pages that answer 200 while meaning 404 — parked domains and soft-404s.
 *  `campfiremusic.org/lander` (GoDaddy parking page) and rvamag's "NO RESULTS
 *  FOUND" template both return a perfectly healthy 200 with real body text. */
const DEAD_PAGE_MARKERS = [
    "no results found",
    "page not found",
    "page you requested could not be found",
    "this domain is registered",
    "domain is for sale",
    "buy this domain",
    "checking your browser",
    "enable javascript",
];

/** Google's grounded-search results arrive as short-lived redirect tokens on
 *  `vertexaisearch.cloud.google.com`. They expire, and an expired one 404s —
 *  which is precisely what a user saw when they clicked a citation. One of
 *  these must never be persisted or shown; resolve it to a destination or
 *  drop the candidate. */
export function isGroundingRedirect(url: string): boolean {
    return url.includes("vertexaisearch.cloud.google.com");
}

/** Fold to a comparable form: lowercase, strip diacritics, collapse anything
 *  that isn't a letter or digit to a single space. So "Pete Rango" matches
 *  "PETE RANGO", "Pete&nbsp;Rango" and "pete-rango". */
function fold(text: string): string {
    return text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

/** Does this page actually talk about this artist?
 *
 *  A page we fetched successfully can still be the wrong page — a parked
 *  domain, a site-wide 404 template, or (as happened here) a profile that has
 *  since been anonymized. Requiring the artist's name to appear in text we are
 *  about to cite FOR A CLAIM ABOUT THAT ARTIST is a low bar that a stale or
 *  invented URL reliably fails.
 *
 *  Matches the full name, or the most distinctive token in it. Requiring EVERY
 *  token was tried first and was wrong: the artist's own homepage renders
 *  "RANGO" as a wordmark and puts "Pete" only in an image, so demanding both
 *  "pete" and "rango" rejected his actual website. The distinctive token alone
 *  still rejects everything this check exists to catch — a parked GoDaddy page,
 *  a "NO RESULTS FOUND" template, and an anonymized profile contain no part of
 *  the name — while keeping real pages that style the name unusually.
 *
 *  Namesake risk is real but is not this function's job: discovery already
 *  passes the artist's verified profile IDs as identity context, and the artist
 *  themselves reviews every source in the vault step before anything is cited. */
export function nameAppearsIn(text: string, artistName: string, opts?: { requireFullName?: boolean }): boolean {
    const haystack = fold(text);
    const name = fold(artistName);
    if (!name) return false;
    if (haystack.includes(name)) return true;

    // Search-retrieved candidates must clear the higher bar. The distinctive-token
    // fallback below is calibrated for pages we already believe belong to the
    // artist (their own site, a link they handed us), where an unusual wordmark
    // is the risk. It is far too loose for anything a keyword search returned:
    // "Black Dave"'s distinctive token is "black", which matches a large fraction
    // of the web — including the Guardian interview with Dave the UK rapper about
    // his song "Black". Passing that would make a namesake article citable in the
    // artist's About, which is worse than the invented URLs this path replaced.
    if (opts?.requireFullName) return false;

    // Longest token = most distinctive. A 4-char floor keeps "the"/"dj"/"lil"
    // and similar from matching half the web on their own.
    const distinctive = name.split(" ")
        .filter(t => t.length >= 4)
        .sort((a, b) => b.length - a.length)[0];
    return distinctive ? haystack.includes(distinctive) : false;
}

/**
 * The gate. Decide what a fetched candidate is actually worth.
 *
 * Read the status first, because status carries information the body cannot:
 * a 404 with a beautifully rendered "not found" page and a 403 from Cloudflare
 * are opposite facts about whether the URL is real, and both arrive with no
 * usable text.
 */
export function classifyFetchedSource(
    page: PageContent,
    artistName: string,
    opts?: {
        requireFullName?: boolean;
        /** An external check has already READ this page and confirmed it is
         *  about this artist (see sourceRelevance). That is strictly stronger
         *  evidence than any string match, so the name test is skipped rather
         *  than allowed to veto it — genuine press written under an artist's
         *  earlier name ("Black Dave" for "Black Dave MK2") contains neither
         *  the full name nor, necessarily, its distinctive token. */
        identityConfirmed?: boolean;
    },
): SourceVerification {
    const { status, extractedText } = page;

    // Never completed. Only a nonexistent hostname is proof of a bad URL — a
    // model that invents a source invents its domain too (`belltower.pictures`
    // alongside the real `belltowerpictures.com`). A timeout or transient network
    // error says nothing about whether the page exists, and treating it as proof
    // deletes real sources on a bad network day, so those degrade to leads.
    if (status === null) return page.failure === "dns" ? "dead" : "lead";
    // The server is telling us this page does not exist.
    if (status === 404 || status === 410) return "dead";
    // Real host, real endpoint, we just aren't allowed in (403/401/429) or it
    // broke (5xx). The URL may be perfectly good — keep it as an unverified lead.
    if (!(status >= 200 && status < 300)) return "lead";

    // 200 but nothing readable: almost always a JS-rendered page. Real, unread.
    if (!extractedText || extractedText.length < MIN_VERIFIED_TEXT) return "lead";

    // Read the FULL body for the checks below, not the stored slice. An article
    // that first names the artist 6,000 characters in is still about the artist;
    // judging it on our own truncation is how two real interviews got demoted.
    const body = page.fullText ?? extractedText;

    const lower = body.toLowerCase();
    if (DEAD_PAGE_MARKERS.some(marker => lower.includes(marker))) return "dead";

    // Fetched and readable, but not about this artist — a stale URL that now
    // points somewhere else, or a namesake. Not evidence for a claim about them.
    if (!opts?.identityConfirmed && !nameAppearsIn(body, artistName, opts)) return "lead";

    return "verified";
}

/**
 * Is a STORED vault row citable?
 *
 * Deliberately derived from data already on every row rather than a new column:
 * `extracted_text` is only ever populated for a source that passed
 * `classifyFetchedSource`, so its presence IS the verification record, and this
 * predicate is correct for the rows already in the database with no backfill.
 *
 * The grounding-redirect check is belt-and-braces for rows written before that
 * rule existed — a few are in the database with full extracted text, and their
 * URLs have since expired to 404s.
 */
export function isCitableSource(row: { url: string; extractedText: string | null }): boolean {
    if (!row.url || isGroundingRedirect(row.url)) return false;
    return (row.extractedText?.length ?? 0) >= MIN_VERIFIED_TEXT;
}
