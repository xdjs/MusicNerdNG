/**
 * Provider-agnostic web search — the seam that lets discovery's last-resort
 * tier (see `profileDiscovery.ts` tier 4) ask a REAL search API "who holds
 * this handle on this domain" instead of asking a grounded LLM to decide
 * whether/what to search. Measured live, that Gemini-`googleSearch` shape
 * timed out on most platforms and, when it did answer, confidently returned
 * an unrelated page (see the web-search report) — a model deciding whether
 * to search is not a substitute for an actual search API.
 *
 * Tavily is the only IMPLEMENTED backend today — it has a genuinely free
 * tier (1,000 credits/month, no card required), which is why it's the one
 * built first. Perplexity's Search API (`POST
 * https://api.perplexity.ai/search`, `search_domain_filter`) is the intended
 * next backend — same query + domain-filter shape — selected via
 * `WEB_SEARCH_PROVIDER`, but is NOT implemented; see the `PROVIDERS` registry
 * below for the seam. There is deliberately no `perplexitySearch` stub that
 * pretends to work — an unimplemented/unknown provider degrades to `[]`,
 * same as every other failure mode here.
 *
 * NEVER throws. No API key configured for the selected provider, an unknown
 * provider, a network failure, a non-OK HTTP response, or an unparseable
 * body all degrade to `[]` — the same "a discovery failure can never break
 * the onboarding turn" contract every tier in `profileDiscovery.ts` already
 * follows.
 */
import { TAVILY_API_KEY, WEB_SEARCH_PROVIDER } from "@/env";

export interface WebSearchResult {
    url: string;
    title: string;
    snippet: string;
}

export interface WebSearchOptions {
    /** Domains to restrict results to (e.g. `["instagram.com"]`). Passed
     *  through untouched to the provider's own domain-filter field. */
    includeDomains?: string[];
    maxResults?: number;
}

type ResolvedWebSearchOptions = Required<WebSearchOptions>;

/** Per-request hard timeout — mirrors `linkPreview.ts`'s `fetchWithTimeout`
 *  pattern (a short AbortController timeout, never throws). Kept short so a
 *  slow/hung provider can't eat into discovery's overall budget when up to
 *  8 platform searches are in flight in parallel (see profileDiscovery.ts's
 *  tier 4). */
const REQUEST_TIMEOUT_MS = 6_000;

const DEFAULT_MAX_RESULTS = 5;

/** fetch() with a hard AbortController timeout. Returns null (never throws)
 *  on any network failure, abort, or non-fetch exception — same contract as
 *  `linkPreview.ts`'s helper of the same shape. */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

const TAVILY_ENDPOINT = "https://api.tavily.com/search";

interface TavilyResultRow {
    title?: unknown;
    url?: unknown;
    content?: unknown;
}

interface TavilyResponseBody {
    results?: TavilyResultRow[];
}

/** Tavily backend — `POST https://api.tavily.com/search`. Request/response
 *  shape verified against Tavily's current documented API reference
 *  (docs.tavily.com/documentation/api-reference/endpoint/search), NOT
 *  guessed:
 *  - auth: `Authorization: Bearer tvly-...` header (not an `api_key` body field).
 *  - request body is snake_case: `query`, `include_domains`, `max_results`.
 *    (`WebSearchResult` stays camelCase — the snake_case here is Tavily's
 *    wire format, not this module's public shape.)
 *  - response: `results[]` with `{ title, url, content, score, ... }` — note
 *    `content`, not `snippet`; the rename to `snippet` happens at this
 *    boundary so callers never need to know Tavily's field name. */
async function tavilySearch(query: string, opts: ResolvedWebSearchOptions): Promise<WebSearchResult[]> {
    const res = await fetchWithTimeout(TAVILY_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${TAVILY_API_KEY}`,
        },
        body: JSON.stringify({
            query,
            include_domains: opts.includeDomains,
            max_results: opts.maxResults,
        }),
    });
    // EVERY FAILURE HERE WAS SILENT. Each of these returned [] and said
    // nothing, which is indistinguishable from "the web has nothing about this
    // artist" — so a rate limit, an expired key or a spent quota would degrade
    // onboarding to no sources and no About with no trace anywhere. Tavily's
    // plan limit is a real ceiling and this is how it will announce itself.
    if (!res) {
        console.error(`[webSearch] Tavily did not respond (timeout or network) for: ${query.slice(0, 80)}`);
        return [];
    }
    if (!res.ok) {
        // The body carries Tavily's reason — 401 bad key, 429 rate limit, 432
        // plan exhausted. Worth having in the log rather than just the status.
        const detail = await res.text().catch(() => "");
        console.error(`[webSearch] Tavily HTTP ${res.status} for "${query.slice(0, 60)}": ${detail.slice(0, 200)}`);
        return [];
    }

    let body: TavilyResponseBody;
    try {
        body = await res.json();
    } catch (e) {
        console.error(`[webSearch] Tavily returned unparseable JSON for "${query.slice(0, 60)}":`, e);
        return [];
    }
    if (!Array.isArray(body?.results)) {
        console.error(`[webSearch] Tavily response had no results array for "${query.slice(0, 60)}"`);
        return [];
    }

    const out: WebSearchResult[] = [];
    for (const row of body.results) {
        if (typeof row?.url !== "string" || !row.url) continue;
        out.push({
            url: row.url,
            title: typeof row.title === "string" ? row.title : "",
            snippet: typeof row.content === "string" ? row.content : "",
        });
    }
    return out;
}

/** Backend registry, selected by `WEB_SEARCH_PROVIDER` (default "tavily").
 *  To add Perplexity: implement `perplexitySearch` against `POST
 *  https://api.perplexity.ai/search` / `search_domain_filter` and add a
 *  `"perplexity"` entry here — no caller-visible change required. This is
 *  the swap seam the module docblock describes; deliberately left as a
 *  registry gap (falls through to the "unknown provider" branch in
 *  `webSearch` below) rather than a stub implementation. */
const PROVIDERS: Record<string, (query: string, opts: ResolvedWebSearchOptions) => Promise<WebSearchResult[]>> = {
    tavily: tavilySearch,
};

/** Search the web, provider-agnostic. NEVER throws.
 *  - No API key configured for the selected provider -> returns `[]`
 *    immediately, no network call — this is the expected "not configured
 *    yet" path in any environment without `TAVILY_API_KEY` set.
 *  - Unknown `WEB_SEARCH_PROVIDER`, or a network/HTTP/parse failure inside
 *    the provider -> logs and returns `[]`.
 */
export async function webSearch(query: string, opts?: WebSearchOptions): Promise<WebSearchResult[]> {
    const provider = WEB_SEARCH_PROVIDER || "tavily";
    if (provider === "tavily" && !TAVILY_API_KEY) {
        // Expected in an environment that has not configured it, and
        // catastrophic in one that thinks it has: no key means no sources, no
        // knowledge document and no About, with nothing in the logs to say so.
        console.warn("[webSearch] No TAVILY_API_KEY — web search is OFF. Discovery loses its last-resort tier and the vault finds no sources.");
        return [];
    }

    const run = PROVIDERS[provider];
    if (!run) {
        console.error(`[webSearch] unknown WEB_SEARCH_PROVIDER "${provider}"`);
        return [];
    }

    const resolvedOpts: ResolvedWebSearchOptions = {
        includeDomains: opts?.includeDomains ?? [],
        maxResults: opts?.maxResults ?? DEFAULT_MAX_RESULTS,
    };

    try {
        return await run(query, resolvedOpts);
    } catch (e) {
        console.error(`[webSearch] provider "${provider}" failed for query "${query}":`, e);
        return [];
    }
}
