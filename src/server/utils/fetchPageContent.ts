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

    if (isUnsafeUrl(url)) {
        return { title, extractedText: null, status: null, failure: "network" };
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

    return { title, snippet, extractedText, ogImage, status, failure, fullText };
}
