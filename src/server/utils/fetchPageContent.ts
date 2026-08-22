export interface PageContent {
    title: string;
    snippet?: string;
    extractedText: string | null;
    ogImage?: string;
    /** The HTTP status the page answered with, or `null` when the request never
     *  completed at all (DNS failure, TLS error, timeout, unsafe URL).
     *
     *  This distinction is load-bearing, not diagnostic. Collapsing "this host
     *  does not exist" and "this host refused a bot" into one empty result is
     *  what let a hallucinated URL sit in the vault looking exactly like a real
     *  source that merely blocks scrapers. Callers classify on it — see
     *  `classifyFetchedSource`. */
    status: number | null;
    /** Why the request never completed, when `status` is null. The distinction is
     *  the difference between deleting a real source and keeping a fake one:
     *  `dns` means the hostname does not exist (a model invented the domain),
     *  while `timeout`/`network` mean a real host was simply slow or unreachable
     *  right now — which must not be read as proof the URL is fake. */
    failure?: "dns" | "timeout" | "network";
    /** The COMPLETE body text, untruncated — for verification only, never for
     *  storage (`extractedText` is the capped, storable form).
     *
     *  Verification must not be defeated by our own storage cap. Two genuinely
     *  relevant articles were misclassified as unverified because they mention
     *  the artist for the first time past the 5,000-character slice: the text we
     *  kept simply didn't contain his name, so a real source looked like a wrong
     *  one. Checks that ask "is this page about X" read this field. */
    fullText?: string;
    /** When the page says it was published, as an ISO date (YYYY-MM-DD), or null
     *  when it does not say.
     *
     *  Without this, everything a source contains reads as current. A real
     *  artist's profile stated "Parris Pierce is my production partner" in the
     *  present tense, from an interview several years old — true when written,
     *  presented as true now. The document cannot scope a claim in time if it
     *  does not know when the claim was made. */
    publishedAt?: string | null;
    /** Same-host article links found on the page, absolute and deduped.
     *
     *  Only populated so an INDEX page can be followed to what it indexes. A tag
     *  archive is a table of contents, not a dead end: rvamag.com's
     *  "Pete Rango Kevin Carroll" tag lists a real piece he is credited on, and
     *  both storing the index and discarding it lose that piece. */
    links?: string[];
}

/** Decode HTML entities (&#8217; → ', &amp; → &, etc.) */
export function decodeEntities(str: string): string {
    return str
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/&mdash;/g, "—")
        .replace(/&ndash;/g, "–")
        .replace(/&rsquo;/g, "'")
        .replace(/&lsquo;/g, "'")
        .replace(/&rdquo;/g, "\u201D")
        .replace(/&ldquo;/g, "\u201C")
        .replace(/&hellip;/g, "…");
}

/** Extract `og:image` from raw HTML (tolerant of either attribute order).
 *  Only ever returns an `https://` URL — data URIs and relative paths are
 *  rejected. Shared by `fetchPageContent` and `linkPreview.ts` so the two
 *  never drift out of sync. */
export function extractOgImage(html: string): string | null {
    const match = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
        ?? html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    if (match?.[1]) {
        // Entity-decode BEFORE the scheme check: serializers escape `&` as
        // `&amp;` inside attribute values, so a query-string-bearing image URL
        // (e.g. Instagram's signed CDN links) comes back as
        // `...?a=1&amp;b=2` — decode first or it's used broken as an <img src>.
        const imgUrl = decodeEntities(match[1].trim());
        if (imgUrl.startsWith("https://")) return imgUrl;
    }
    return null;
}

/** Extract `og:title` from raw HTML (tolerant of either attribute order). */
export function extractOgTitle(html: string): string | null {
    const match = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
        ?? html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
    return match?.[1] ? decodeEntities(match[1].trim()) : null;
}

/** Block SSRF: reject internal/private network URLs */
export function isUnsafeUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
        const host = parsed.hostname.toLowerCase();
        if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "[::1]") return true;
        // Block IPv6 private ranges (unique local fc00::/7)
        const bare = host.replace(/^\[|\]$/g, ""); // host is already lowercased
        if (bare.startsWith("fc") || bare.startsWith("fd")) return true;
        // Block fe80::–feff:: (link-local fe80::/10 + deprecated site-local fec0::/10)
        if (bare.startsWith("fe")) {
            const nibbles = parseInt(bare.slice(2, 4), 16);
            if (!isNaN(nibbles) && nibbles >= 0x80) return true;
        }
        // Block IPv4-mapped IPv6 (::ffff:x.x.x.x or ::ffff:HHHH:HHHH hex form)
        if (bare.startsWith("::ffff:")) {
            const mapped = bare.slice(7);
            // Dotted form: ::ffff:127.0.0.1
            if (mapped.includes(".")) {
                if (isUnsafeUrl(`http://${mapped}/`)) return true;
            }
            // Hex form: ::ffff:7f00:1 — Node's URL parser normalizes to this
            const hexParts = mapped.split(":");
            if (hexParts.length === 2) {
                const hi = parseInt(hexParts[0], 16);
                const lo = parseInt(hexParts[1], 16);
                if (!isNaN(hi) && !isNaN(lo)) {
                    const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
                    if (isUnsafeUrl(`http://${ipv4}/`)) return true;
                }
            }
        }
        // Block private/link-local IPv4 ranges
        const parts = host.split(".");
        if (parts[0] === "10") return true;
        if (parts[0] === "172" && Number(parts[1]) >= 16 && Number(parts[1]) <= 31) return true;
        if (parts[0] === "192" && parts[1] === "168") return true;
        if (parts[0] === "169" && parts[1] === "254") return true; // cloud metadata
        return false;
    } catch {
        return true;
    }
}

/** Default read budget. Callers on a request-latency path (vault discovery,
 *  which runs inside the onboarding publish/About budget) pass something
 *  tighter — a slow-but-real site being marked unverified is a far better
 *  failure than blowing the turn's deadline. */
const DEFAULT_FETCH_TIMEOUT_MS = 10000;

/** How much body text we keep. A storage cap, not a verification one — see
 *  `PageContent.fullText`. */
/** How much of a page we KEEP. This is the archive: whatever is dropped here is
 *  gone for good, since we do not re-fetch a stored source.
 *
 *  It was 5,000, which is about a fifth of a 4,000-word interview — so a real
 *  artist's credits, sitting at character 2,466 of one profile, were near the
 *  edge, and anything past 5,000 in a longer piece never entered the database at
 *  all. That is not a context limit, it is a leftover: the model reading this
 *  material has roughly a million tokens of context, and a handful of full
 *  sources is about twenty thousand.
 *
 *  Now generous enough to hold a long-form interview whole. Still bounded,
 *  because a pathological page (a forum thread, a full archive dump) should not
 *  put megabytes in a row. selectSourceText decides what reaches the prompt. */
const EXTRACT_MAX_CHARS = 50_000;

/** Elements that never carry a page's subject matter. Removed whole, with their
 *  contents, before anything is read. <header> is deliberately absent: article
 *  headlines and bylines live there too. */
const CHROME_TAGS = [
    "script", "style", "noscript", "template", "svg", "iframe",
    "nav", "footer", "aside", "form", "select", "button", "dialog",
];

/** Block closers that end a paragraph. Inline elements (<span>, <a>, <em>)
 *  deliberately stay a space so a sentence isn't cut mid-clause. */
const BLOCK_BREAK = /<\/(p|div|section|article|li|ul|ol|tr|h[1-6]|blockquote|figcaption|dd|dt|pre|table)\s*>|<br\s*\/?>|<hr\s*\/?>/gi;

function textFrom(bodyHtml: string, stripChrome: boolean): string {
    let html = bodyHtml.replace(/<!--[\s\S]*?-->/g, " ");
    if (stripChrome) {
        for (const tag of CHROME_TAGS) {
            html = html.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), " ");
        }
    } else {
        // Script and style are never readable text, whatever else we keep.
        html = html
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ");
    }
    return decodeEntities(
        html.replace(BLOCK_BREAK, "\n\n").replace(/<[^>]+>/g, " ")
    )
        // Horizontal whitespace only. Collapsing newlines too is the bug this
        // function exists to fix.
        .replace(/[^\S\n]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/**
 * The readable text of a page: the article, not the furniture.
 *
 * Two problems with the one-liner this replaces, both found by dumping what we
 * had actually stored about a real artist:
 *
 * 1. `\s+ -> " "` flattened every page to a SINGLE LINE. `selectSourceText`,
 *    which keeps the paragraphs that name the artist, splits on blank lines —
 *    so it always saw one paragraph, bailed out, and head-sliced instead. That
 *    selection had never once run against a real scrape; its unit tests passed
 *    because they fed it text with newlines still in it.
 * 2. Nothing was removed but <script> and <style>. So a stored "source" could
 *    be a cookie-consent policy listing Google Analytics cookie durations
 *    (lifechangesnetwork, everything past character 4,700), or a comment form
 *    and a list of unrelated articles (voyagemia).
 *
 * Drop the chrome, keep the block structure, decode the entities. What survives
 * is roughly what a reader would have read.
 *
 * Regex rather than a DOM parse on purpose: this runs on a request-latency path
 * during onboarding, against pages we do not control, and a partial result is
 * fine — whatever survives is judged again by judgeSourceRelevance and
 * selectSourceText. It CANNOT remove a rival's listing from a marketplace page
 * (soundbetter renders other producers' credits in the same generic <div>s as
 * the artist's own), so it is the first line of defence, not the only one.
 */
export function extractReadableText(bodyHtml: string): string {
    const cleaned = textFrom(bodyHtml, true);
    // Safety net for a page that wraps its ARTICLE in <aside> or <form>: we would
    // otherwise store nothing. Deliberately narrow — it needs a substantial page
    // gutted down to almost nothing, so that a genuinely short page stripped to
    // its few real sentences is left alone rather than having its nav put back.
    if (cleaned.length < 200) {
        const raw = textFrom(bodyHtml, false);
        if (raw.length > 1000) return raw;
    }
    return cleaned;
}

/** Meta names/properties that carry a publication date, best evidence first.
 *  `article:published_time` is what the artist actually said it was; `og:updated_time`
 *  is when the CMS last touched the page, which is weaker but still bounds it. */
const DATE_META_KEYS = [
    "article:published_time",
    "article:modified_time",
    "datepublished",
    "date",
    "dc.date.issued",
    "og:updated_time",
    "pubdate",
];

/**
 * When a page says it was published, as `YYYY-MM-DD`, or null when it does not say.
 *
 * Every source we store reads as present-tense otherwise. A years-old interview
 * saying "Parris Pierce is my production partner" is true about the moment it was
 * written and says nothing about now — but the document had no way to tell the
 * difference, so it wrote the claim as a current fact.
 *
 * Deliberately conservative. A wrong date is worse than none: it would let the
 * document confidently scope a claim to the wrong era. Anything that doesn't
 * parse, or lands outside a plausible window, returns null and the claim stays
 * unscoped rather than mis-scoped.
 */
export function extractPublishedDate(html: string, now: Date = new Date()): string | null {
    const candidates: string[] = [];

    for (const key of DATE_META_KEYS) {
        const k = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(
            `<meta[^>]*(?:property|name)=["']${k}["'][^>]*content=["']([^"']+)["']`
            + `|<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${k}["']`,
            "i",
        );
        const m = html.match(re);
        if (m) candidates.push(m[1] ?? m[2]);
    }

    // JSON-LD is the other place publishers put this, and often the only one.
    for (const block of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
        const m = block[1]?.match(/"datePublished"\s*:\s*"([^"]+)"/);
        if (m) candidates.push(m[1]);
    }

    // <time datetime="..."> last: it marks any date on the page, including a
    // comment's or an unrelated article's in a sidebar.
    const timeTag = html.match(/<time[^>]*datetime=["']([^"']+)["']/i);
    if (timeTag) candidates.push(timeTag[1]);

    for (const raw of candidates) {
        const parsed = new Date(raw.trim());
        if (isNaN(parsed.getTime())) continue;
        const year = parsed.getUTCFullYear();
        // The web did not exist before 1995, and a future date is a template
        // placeholder or a bad parse, not a publication date.
        if (year < 1995 || parsed.getTime() > now.getTime() + 86_400_000) continue;
        return parsed.toISOString().slice(0, 10);
    }
    return null;
}

/** Path segments that mark a listing rather than an article. */
const NON_ARTICLE_PATH = /\/(tags?|categor(y|ies)|author|page|search|feed|wp-|wp-content|wp-admin|comments?|login|register|subscribe|privacy|terms|contact|about-us)(\/|$|\?)/i;

/**
 * Same-host links from a page that plausibly point at articles.
 *
 * Used to follow an INDEX to its contents. A tag archive or category page is a
 * table of contents — dropping it loses the real coverage behind it, and storing
 * it stores navigation. Following it gets the article, which is then judged on
 * its own merits like any other candidate.
 *
 * Same host only: an index's off-site links are ads, social buttons and
 * syndication, and following those turns one page into the open web.
 */
export function extractArticleLinks(html: string, baseUrl: string, max = 25): string[] {
    let origin: string;
    let basePath: string;
    try {
        const u = new URL(baseUrl);
        origin = u.origin;
        basePath = u.pathname.replace(/\/$/, "");
    } catch { return []; }

    const out: string[] = [];
    const seen = new Set<string>();
    for (const m of html.matchAll(/<a[^>]+href=["']([^"'\s>]+)["']/gi)) {
        let href = m[1];
        if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
        try {
            const abs = new URL(href, baseUrl);
            if (abs.origin !== origin) continue;
            abs.hash = "";
            href = abs.toString().replace(/\/$/, "");
            const path = abs.pathname.replace(/\/$/, "");
            if (!path || path === basePath) continue;
            // A bare section root ("/community") is another index, not a piece.
            if (path.split("/").filter(Boolean).length < 2 && !/\.html?$/i.test(path)) continue;
            if (NON_ARTICLE_PATH.test(path)) continue;
            if (seen.has(href)) continue;
            seen.add(href);
            out.push(href);
            if (out.length >= max) break;
        } catch { /* unparseable href */ }
    }
    return out;
}

/**
 * Fetch a URL and extract title, meta description, and body text.
 * Returns a domain-based fallback title on failure, and always reports
 * `status` so the caller can tell a dead URL from a bot-blocked one.
 */
export async function fetchPageContent(
    url: string,
    opts: { timeoutMs?: number } = {}
): Promise<PageContent> {
    let title = "Untitled Source";
    let snippet: string | undefined;
    let extractedText: string | null = null;
    let ogImage: string | undefined;
    let status: number | null = null;
    let failure: PageContent["failure"];
    let fullText: string | undefined;
    let publishedAt: string | null = null;
    let links: string[] | undefined;

    if (isUnsafeUrl(url)) {
        return { title, extractedText: null, status: null, failure: "network", publishedAt: null };
    }

    try {
        const parsed = new URL(url);
        title = `Source from ${parsed.hostname.replace("www.", "")}`;

        const res = await fetch(url, {
            headers: { "User-Agent": "MusicNerdBot/1.0" },
            signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS),
        });
        status = res.status;
        if (res.ok) {
            const html = await res.text();

            // Extract <title>
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (titleMatch?.[1]) title = decodeEntities(titleMatch[1].trim());

            // Extract meta description
            const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
                ?? html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
            if (descMatch?.[1]) snippet = decodeEntities(descMatch[1].trim());

            // Extract og:description as fallback snippet
            if (!snippet) {
                const ogMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)
                    ?? html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/i);
                if (ogMatch?.[1]) snippet = decodeEntities(ogMatch[1].trim());
            }

            // Extract og:image
            ogImage = extractOgImage(html) ?? undefined;

            // When the page says it was published — so a claim from a years-old
            // interview can be scoped in time rather than stated as current.
            publishedAt = extractPublishedDate(html);
            links = extractArticleLinks(html, url);

            // Extract body text: the article, not the page furniture.
            const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
            if (bodyMatch?.[1]) {
                const text = extractReadableText(bodyMatch[1]);
                if (text.length > 50) {
                    fullText = text;
                    extractedText = text.slice(0, EXTRACT_MAX_CHARS);
                }
            }
        }
    } catch (e) {
        // Request never completed. Record WHY: a nonexistent hostname is strong
        // evidence the URL was invented, whereas a timeout says nothing about
        // whether the page is real. Node surfaces the syscall error on `cause`.
        const cause = (e as { cause?: { code?: string } })?.cause;
        const code = cause?.code;
        const name = (e as { name?: string })?.name;
        if (code === "ENOTFOUND" || code === "EAI_AGAIN") failure = "dns";
        else if (name === "TimeoutError" || name === "AbortError") failure = "timeout";
        else failure = "network";
    }

    return { title, snippet, extractedText, ogImage, status, failure, fullText, publishedAt, links };
}
