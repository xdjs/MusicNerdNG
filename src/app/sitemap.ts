import type { MetadataRoute } from "next";
import { db } from "@/server/db/drizzle";
import { sql } from "drizzle-orm";
import { ABOUT_EMPTY_STATE } from "@/lib/bioConstants";

/**
 * Which pages we are asking search engines to read.
 *
 * There was no sitemap worth the name: `public/sitemap.xml` held ONE url, the
 * homepage, against 41,988 artist pages. Every bit of structured data on those
 * pages sat somewhere a crawler had no route to, and the goal of being the
 * source an assistant cites is unreachable from a site nothing can enumerate.
 *
 * BUT NOT ALL OF THEM, and this is the part that matters. Of those 41,988, two
 * hundred and sixty-two have a real About and three have an approved source.
 * The rest are a name and some links — plus rows like "nonexistentartist123".
 * Submitting forty thousand near-empty pages is not neutral: thin content at
 * scale is a quality signal against the whole domain, and it would bury the
 * pages we actually want cited underneath the ones we do not.
 *
 * So a page earns its place by having something to say. The bar is deliberately
 * one query and one constant, because it will move as onboarding fills pages
 * in — every artist who completes onboarding crosses it, so this grows on its
 * own without anybody remembering to come back.
 */
export const revalidate = 86_400;   // a day; artist pages do not change hourly

const BASE = "https://www.musicnerd.xyz";

/**
 * A page is worth crawling when it says something a search engine or an
 * assistant could use: prose about who the artist is, or press we verified.
 *
 * Links alone are deliberately NOT enough. Thirty-eight thousand pages carry a
 * platform link and nothing else; that is a redirect with a logo on it, and at
 * that volume it is the thin-content problem rather than a directory.
 *
 * To widen this — say, once most pages have been built out — add to the OR.
 */
const WORTH_CRAWLING = sql`
    (
        a.bio IS NOT NULL
        AND length(a.bio) > 120
        -- LENGTH IS NOT SUBSTANCE. artistBioQuery caches the claim-nudge empty
        -- state into artists.bio for a thin artist, and it runs to well over a
        -- hundred characters while explicitly saying there is nothing verified
        -- here — so the filter would have admitted exactly the pages it exists
        -- to keep out, more of them every day.
        AND btrim(a.bio) <> ${ABOUT_EMPTY_STATE}
    )
    OR EXISTS (
        SELECT 1 FROM artist_vault_sources s
         WHERE s.artist_id = a.id AND s.status = 'approved'
    )`;

/** Sitemaps cap at 50,000 urls. Well clear today; if the bar ever widens far
 *  enough to approach it, this needs splitting into an index. */
const MAX_URLS = 45_000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const staticPages: MetadataRoute.Sitemap = [
        { url: `${BASE}/`, changeFrequency: "daily", priority: 1 },
        { url: `${BASE}/leaderboard`, changeFrequency: "daily", priority: 0.5 },
    ];

    try {
        const rows = await db.execute(sql`
            SELECT a.id, a.updated_at
              FROM artists a
             WHERE ${WORTH_CRAWLING}
             ORDER BY a.updated_at DESC NULLS LAST
             LIMIT ${MAX_URLS}`);
        const list = ((rows as { rows?: unknown[] }).rows ?? (rows as unknown[]) ?? []) as Record<string, unknown>[];

        return [
            ...staticPages,
            ...list.map(r => ({
                url: `${BASE}/artist/${String(r.id)}`,
                // What we last knew about them, so a crawler that has seen the
                // page before can skip it.
                lastModified: r.updated_at ? new Date(String(r.updated_at)) : undefined,
                changeFrequency: "weekly" as const,
                priority: 0.8,
            })),
        ];
    } catch (e) {
        // A sitemap that 500s is worse than a small one: a crawler treats the
        // error as a reason to back off the whole site.
        console.error("[sitemap] Could not list artists:", e);
        return staticPages;
    }
}
