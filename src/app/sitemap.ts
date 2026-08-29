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
 * assistant could use.
 *
 * THE FIRST VERSION OF THIS WAS TOO STRICT, and the reasoning was borrowed
 * rather than earned. It admitted only pages with prose — 262 of 41,988 — on
 * the argument that thin content at scale is a quality signal against the
 * domain. That rule is about auto-generated filler and doorway pages. It is not
 * about database records: Discogs and MusicBrainz carry millions of sparse
 * entries and rank fine, because a verified entry IS the product.
 *
 * A page with an artist's links across three or more platforms, and JSON-LD
 * sameAs making that identity machine-readable, is the answer to "where do I
 * find X" — which is a question assistants are asked constantly, and the one
 * this directory exists to answer. Excluding thirty thousand of them to protect
 * two hundred is the wrong trade, and being invisible for 41,726 artists
 * defeats the point of wanting to be cited.
 *
 * A sitemap is also a discovery aid rather than an index guarantee: crawlers
 * decide what to keep. What we owe them is a list without junk in it.
 *
 * SO THE BAR IS "IS THERE ANYTHING HERE", not "is there prose here":
 *   - a real About, which is not the cached empty state; or
 *   - press we verified; or
 *   - a usable set of verified links.
 *
 * Which leaves out the pages with genuinely nothing on them — 1,237 with
 * neither a link nor a bio — and the test rows.
 */

/** Below this a page is a name and a stray handle rather than a record worth
 *  sending anybody to. */
const MIN_PLATFORM_LINKS = 3;

const LINK_COUNT = sql`(
    (a.spotify IS NOT NULL)::int + (a.instagram IS NOT NULL)::int + (a.x IS NOT NULL)::int
  + (a.youtube IS NOT NULL)::int + (a.soundcloud IS NOT NULL)::int + (a.bandcamp IS NOT NULL)::int
  + (a.deezer IS NOT NULL)::int + (a.facebook IS NOT NULL)::int + (a.tiktok IS NOT NULL)::int
)`;

const WORTH_CRAWLING = sql`
    (
        (
            a.bio IS NOT NULL
            AND length(a.bio) > 120
            -- LENGTH IS NOT SUBSTANCE. artistBioQuery caches the claim-nudge
            -- empty state into artists.bio for a thin artist, and it runs well
            -- past a hundred characters while explicitly saying there is
            -- nothing verified here.
            AND btrim(a.bio) <> ${ABOUT_EMPTY_STATE}
        )
        OR EXISTS (
            SELECT 1 FROM artist_vault_sources s
             WHERE s.artist_id = a.id AND s.status = 'approved'
        )
        OR ${LINK_COUNT} >= ${MIN_PLATFORM_LINKS}
    )
    -- Rows that are not artists. "nonexistentartist123" is in here, and a
    -- crawler meeting it first is the impression we would be making.
    AND a.name !~* '(^|[^a-z])(test artist|nonexistent|asdf)'`;

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
