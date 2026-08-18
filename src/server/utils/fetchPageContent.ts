export interface PageContent {
    title: string;
    snippet?: string;
    extractedText: string | null;
    ogImage?: string;
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

/**
 * Fetch a URL and extract title, meta description, and body text.
 * Returns domain-based fallback title on failure.
 */
export async function fetchPageContent(url: string): Promise<PageContent> {
    let title = "Untitled Source";
    let snippet: string | undefined;
    let extractedText: string | null = null;
    let ogImage: string | undefined;

    if (isUnsafeUrl(url)) {
        return { title, extractedText: null };
    }

    try {
        const parsed = new URL(url);
        title = `Source from ${parsed.hostname.replace("www.", "")}`;

        const res = await fetch(url, {
            headers: { "User-Agent": "MusicNerdBot/1.0" },
            signal: AbortSignal.timeout(10000),
        });
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

            // Extract body text (strip tags, collapse whitespace)
            const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
            if (bodyMatch?.[1]) {
                const text = bodyMatch[1]
                    .replace(/<script[\s\S]*?<\/script>/gi, "")
                    .replace(/<style[\s\S]*?<\/style>/gi, "")
                    .replace(/<[^>]+>/g, " ")
                    .replace(/\s+/g, " ")
                    .trim();
                if (text.length > 50) {
                    extractedText = text.slice(0, 5000);
                }
            }
        }
    } catch {
        // Fetch failed — return what we have
    }

    return { title, snippet, extractedText, ogImage };
}
