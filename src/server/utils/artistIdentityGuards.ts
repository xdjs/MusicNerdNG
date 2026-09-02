import { db } from "@/server/db/drizzle";
import { sql } from "drizzle-orm";
import { PLATFORM_DOMAINS } from "@/server/utils/artistPlatforms";

/**
 * Is this handle really this artist's?
 *
 * These three checks guarded the vault's adoption path and nothing else. The
 * onboarding auto-build wrote every profile discovery handed it, unguarded —
 * and that is the path every artist takes. With three Black Daves in the
 * directory, onboarding gave Black Dave the Instagram belonging to a different
 * one, and gave Black Dave MK2 a third person's. Twelve uses in
 * vaultWebSearch.ts, zero in turnHandlers.ts.
 *
 * They live here rather than in vaultWebSearch because turnHandlers' tests mock
 * that module wholesale, so importing from it would have handed the guards back
 * as `undefined` — a guard that silently does nothing, which is the failure
 * this whole day has been about.
 */

/** A stored handle may carry a legacy leading "@". */
const normalizeHandle = (v: string): string => v.trim().toLowerCase().replace(/^@/, "");

const rowsOf = (result: unknown): unknown[] => {
    if (!result) return [];
    const r = result as { rows?: unknown[] };
    if (Array.isArray(r.rows)) return r.rows;
    return Array.isArray(result) ? result : [];
};

/** Is this (platform, handle) already recorded against a DIFFERENT artist?
 *
 *  Names collide and page titles cannot resolve the collision — three artists
 *  called Black Dave sit in this directory. What the directory already knows can:
 *  a handle assigned to somebody else is not evidence about this artist. */
/**
 * Does this candidate contradict the artist's own scraped posts?
 *
 * Instagram display names are free text, so an account can call itself anything.
 * A blank-slate run for Pharaoh Sistare adopted instagram=pherosistar because
 * the page title read "Pharaoh Sistare (@pherosistar)" — our verification
 * asking "does the page name the artist" was satisfied by an account that
 * merely CLAIMS to be him. His real handle is pharaohsistare.
 *
 * Requiring the handle to resemble the name would catch that and would also
 * reject p3t3rango for Pete Rango, which is his actual account. But we are not
 * short of evidence here: we have scraped his feed, and every post in it is
 * authored by pharaohsistare. That handle was established when the posts were
 * ingested. A search result cannot outrank it.
 *
 * Only speaks when it knows: no stored posts means no opinion, and a run with a
 * genuinely cold start is unaffected.
 */
export async function contradictsScrapedPosts(artistId: string, siteName: string, handle: string): Promise<boolean> {
    if (siteName !== "instagram") return false;   // the only platform we scrape
    try {
        const rows = await db.execute(sql`
            select distinct owner_username from artist_social_posts
            where artist_id = ${artistId}::uuid and is_own_post = true
            limit 5`);
        const known = rowsOf(rows)
            .map(r => String((r as { owner_username?: unknown }).owner_username ?? ""))
            .filter(Boolean)
            .map(normalizeHandle);
        if (known.length === 0) return false;     // nothing scraped, no opinion
        return !known.includes(normalizeHandle(handle));
    } catch (e) {
        // Fail OPEN here, unlike the ownership guard: this one only ever adds
        // evidence we happen to hold, and treating "could not read our own
        // posts" as "the candidate is wrong" would block adoption for every
        // artist we have never scraped.
        console.error("[vaultWebSearch] Scraped-post check failed:", e);
        return false;
    }
}

export async function handleBelongsToAnotherArtist(artistId: string, siteName: string, handle: string): Promise<boolean> {
    if (!PLATFORM_DOMAINS[siteName]) return false; // not a column we store
    try {
        // `siteName` is a COLUMN NAME and cannot be a bind parameter, so it is
        // interpolated — safe only because the PLATFORM_DOMAINS guard above
        // restricts it to a fixed set of known columns. `handle` and `artistId`
        // are VALUES and are bound, never interpolated: both arrive from search
        // results and page content, so hand-escaping them is not a thing we get
        // to be right about forever.
        const rows = await db.execute(
            // ltrim the stored value as well as the candidate. Some rows carry
            // the legacy "@handle" form, and comparing "@dupes" against "dupes"
            // reported the handle as unclaimed — handing a second artist an
            // account the directory already knew belonged to someone else,
            // which is the one thing this guard exists to prevent.
            sql`select 1 from artists
                where lower(ltrim(${sql.raw(siteName)}, '@')) = lower(ltrim(${handle}, '@'))
                  and id::text <> ${artistId}
                limit 1`);
        return rowsOf(rows).length > 0;
    } catch (e) {
        // Fail CLOSED. This used to return false — "not claimed by anyone" —
        // so a transient database error silently switched off the exact
        // protection this function exists to provide, and did it at the moment
        // things were already going wrong. A gap beats a wrong link, so an
        // unanswerable ownership question is treated as "somebody else may
        // own this" and the candidate is skipped.
        console.error("[vaultWebSearch] Ownership check failed, treating handle as claimed:", e);
        return true;
    }
}

/** Is this artist the GENERIC one among several who share a name?
 *
 *  If so, a page title that merely repeats the name proves nothing about WHICH
 *  of them it belongs to. Three Black Daves are here, and a fourth account
 *  titled "Black Dave (@black_davem)" is indistinguishable from all of them
 *  from outside — so we decline rather than assign one artist another's
 *  account. Stronger evidence still counts: a page corroborated by an id we
 *  already hold is unambiguous no matter how common the name.
 *
 *  Prefix, not equality, and the direction matters. "Black Dave" is a substring
 *  of "Black Dave MK2", so nothing a page says can prove it means the shorter
 *  one — every page about MK2 also contains "Black Dave". The reverse is not
 *  true: only MK2's own bio says "blackdave.mk2", so HE is identifiable and is
 *  not caught here. The generic name declines; the specific one does not. */
export async function nameIsAmbiguousInDirectory(artistId: string, artistName: string): Promise<boolean> {
    const folded = artistName.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (folded.length < 4) return true; // too short to identify anyone
    try {
        const rows = await db.execute(sql`
            select 1 from artists
            where regexp_replace(lower(name), '[^a-z0-9]', '', 'g') like ${folded + "%"}
              and id <> ${artistId}::uuid
            limit 1`);
        return rowsOf(rows).length > 0;
    } catch (e) {
        // Fail CLOSED, for the same reason as handleBelongsToAnotherArtist: a
        // database error is not evidence that a name is unique, and answering
        // "not ambiguous" turns the guard off exactly when the system is
        // already unhealthy.
        console.error("[vaultWebSearch] Ambiguity check failed, treating name as ambiguous:", e);
        return true;
    }
}
