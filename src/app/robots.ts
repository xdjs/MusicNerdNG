import type { MetadataRoute } from "next";
import { generateSitemaps } from "./sitemap";

/**
 * robots.txt, generated so it can name every sitemap chunk.
 *
 * The static public/robots.txt pointed at /sitemap.xml, and there is no
 * /sitemap.xml any more: chunking the sitemap moves the files to
 * /sitemap/0.xml, /sitemap/1.xml and so on, and Next does not serve an index at
 * the old path. A crawler following the old pointer got a 404, which is worse
 * than the one-url sitemap it replaced.
 *
 * robots.txt takes as many Sitemap lines as we give it, so it names the chunks
 * directly and there is no index to keep in step with them. The list comes from
 * the same function that decides how many chunks exist, so the two cannot
 * disagree.
 */
export const revalidate = 86_400;

const BASE = "https://www.musicnerd.xyz";

export default async function robots(): Promise<MetadataRoute.Robots> {
    let chunks: { id: number }[] = [{ id: 0 }];
    try {
        chunks = await generateSitemaps();
    } catch (e) {
        // A robots.txt naming one chunk is worth serving; one that 500s tells a
        // crawler to stay away entirely.
        console.error("[robots] Could not enumerate sitemaps:", e);
    }
    return {
        rules: { userAgent: "*", allow: "/" },
        sitemap: chunks.map(c => `${BASE}/sitemap/${c.id}.xml`),
    };
}
