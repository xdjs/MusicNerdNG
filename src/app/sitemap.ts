import type { MetadataRoute } from "next";
import { db } from "@/server/db/drizzle";
import { sql } from "drizzle-orm";

/**
 * Every artist page, in chunks.
 *
 * There was no sitemap worth the name: `public/sitemap.xml` held ONE url, the
 * homepage, against 41,988 artist pages. Every bit of structured data on those
 * pages sat somewhere a crawler had no route to, and being the source an
 * assistant cites is unreachable from a site nothing can enumerate.
 *
 * NO BAR. Two earlier versions of this filtered — first to pages with prose
 * (262 of 41,988), then to pages with three or more verified links (30,378) —
 * on the argument that thin content at scale is a quality signal against the
 * domain. That rule is about auto-generated filler, not about database records:
 * Discogs and MusicBrainz carry millions of sparse entries and rank fine. Pete
 * settled it — "I don't think we should exclude any artist profiles" — and a
 * directory that hides most of its directory is not one.
 *
 * WHICH MAKES THE 50,000 CAP THE REAL PROBLEM. A sitemap holds fifty thousand
 * urls; there are nearly forty-two thousand artists and the number only goes
 * up. The previous version's answer was to truncate at 45,000, dropping the
 * least recently updated pages in silence — exactly the failure nobody notices
 * until an artist asks why they are not in Google.
 *
 * So this is chunked. Next serves an index at /sitemap.xml pointing at
 * /sitemap/0.xml, /sitemap/1.xml and so on, each well inside the limit, and the
 * number of chunks follows the size of the directory without anybody
 * maintaining it.
 */
export const revalidate = 86_400;   // a day; artist pages do not change hourly

const BASE = "https://www.musicnerd.xyz";

/** Comfortably inside the 50,000 limit, so a burst of new artists between
 *  revalidations cannot push a chunk over it. */
const CHUNK = 20_000;

async function artistCount(): Promise<number> {
    try {
        const rows = await db.execute(sql`SELECT count(*)::int AS n FROM artists`);
        const list = ((rows as { rows?: unknown[] }).rows ?? (rows as unknown[]) ?? []) as Record<string, unknown>[];
        return Number(list[0]?.n ?? 0);
    } catch (e) {
        console.error("[sitemap] Could not count artists:", e);
        return 0;
    }
}

export async function generateSitemaps(): Promise<{ id: number }[]> {
    const total = await artistCount();
    const chunks = Math.max(1, Math.ceil(total / CHUNK));
    return Array.from({ length: chunks }, (_, id) => ({ id }));
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
    // The pages that are not artists ride in the first chunk.
    const staticPages: MetadataRoute.Sitemap = id === 0
        ? [
            { url: `${BASE}/`, changeFrequency: "daily", priority: 1 },
            { url: `${BASE}/leaderboard`, changeFrequency: "daily", priority: 0.5 },
        ]
        : [];

    try {
        // ORDERED BY id, NOT BY DATE. A chunk is a stable window into the list,
        // and ordering by updated_at would shuffle artists between chunks every
        // time anything changed — so a crawler that had already read
        // /sitemap/3.xml would be handed a different set of pages at the same
        // url, and would keep re-reading all of them forever.
        const rows = await db.execute(sql`
            SELECT a.id, a.updated_at
              FROM artists a
             ORDER BY a.id
             LIMIT ${CHUNK} OFFSET ${id * CHUNK}`);
        const list = ((rows as { rows?: unknown[] }).rows ?? (rows as unknown[]) ?? []) as Record<string, unknown>[];

        return [
            ...staticPages,
            ...list.map(r => ({
                url: `${BASE}/artist/${String(r.id)}`,
                // What we last knew about them, so a crawler that has seen the
                // page before can skip it. Omitted rather than faked as "now",
                // which would claim every page changed on every build.
                lastModified: r.updated_at ? new Date(String(r.updated_at)) : undefined,
                changeFrequency: "weekly" as const,
                priority: 0.8,
            })),
        ];
    } catch (e) {
        // A sitemap that 500s is worse than a short one: a crawler reads the
        // error as a reason to back off the whole site.
        console.error(`[sitemap] Could not list artists for chunk ${id}:`, e);
        return staticPages;
    }
}
