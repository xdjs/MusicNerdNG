/**
 * Storage for what `socialCredits.ts` reads out of an artist's captions.
 *
 * Kept separate from the extraction module on purpose: that module has no
 * database dependency, which is what makes it testable against plain-object
 * fixtures. This is the only file that knows the extraction is persisted.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/drizzle";
import { artistSocialCredits } from "@/server/db/schema";
import type { CaptionExtraction, CaptionCredit, ArtistStatement } from "@/server/utils/socialCredits";
import { EMPTY_EXTRACTION } from "@/server/utils/socialCredits";

/** Replace an artist's stored extraction with a fresh one.
 *
 *  Delete-then-insert rather than upsert: an artist's captions can change (a
 *  post is deleted, a caption edited) and a credit that is no longer in the
 *  feed should stop being on their profile. Re-extraction is the only thing
 *  that writes here, so there is nothing to merge with.
 *
 *  Never throws — losing the extraction should cost profile detail, not the
 *  ingest that produced it.
 */
/** Wipe an artist's extraction. Called ONCE when a job starts, never per slice
 *  — the old delete-then-insert was fine for a single pass and would have had
 *  every slice erase the one before it. */
export async function clearSocialCredits(artistId: string): Promise<void> {
    if (!artistId) return;
    try {
        await db.delete(artistSocialCredits).where(eq(artistSocialCredits.artistId, artistId));
    } catch (e) {
        console.error("[clearSocialCredits] Error:", e);
    }
}

/** Add what one slice found. Conflicts are ignored, so a sweep re-finding
 *  something is harmless. */
/** Returns null when the WRITE failed, which is not the same as a slice that
 *  found nothing — returning 0 for both let the caller advance its cursor past
 *  captions whose verified credits had just been dropped on the floor. */
export async function appendSocialCredits(
    artistId: string,
    extraction: CaptionExtraction,
    postedAtByUrl?: Map<string, string | null>,
): Promise<number | null> {
    return writeSocialCredits(artistId, extraction, postedAtByUrl, { clearFirst: false });
}

export async function replaceSocialCredits(
    artistId: string,
    extraction: CaptionExtraction,
    postedAtByUrl?: Map<string, string | null>,
): Promise<number> {
    return (await writeSocialCredits(artistId, extraction, postedAtByUrl, { clearFirst: true })) ?? 0;
}

async function writeSocialCredits(
    artistId: string,
    extraction: CaptionExtraction,
    postedAtByUrl?: Map<string, string | null>,
    opts?: { clearFirst?: boolean },
): Promise<number | null> {
    if (!artistId) return 0;
    const rows = [
        ...extraction.credits.map(c => ({
            artistId,
            kind: "credit" as const,
            subject: c.subject,
            isHandle: c.isHandle,
            isSelf: c.isSelf,
            label: c.role,
            quote: c.quote,
            sourceUrl: c.url,
            postedAt: postedAtByUrl?.get(c.url) ?? null,
        })),
        ...extraction.statements.map(s => ({
            artistId,
            kind: "statement" as const,
            subject: null,
            isHandle: false,
            isSelf: false,
            label: s.topic,
            quote: s.quote,
            sourceUrl: s.url,
            postedAt: postedAtByUrl?.get(s.url) ?? null,
        })),
    ];

    try {
        if (opts?.clearFirst) {
            await db.delete(artistSocialCredits).where(eq(artistSocialCredits.artistId, artistId));
        }
        if (rows.length === 0) return 0;
        await db.insert(artistSocialCredits).values(rows).onConflictDoNothing();
        return rows.length;
    } catch (e) {
        console.error("[writeSocialCredits] Error:", e);
        return null;
    }
}

/** Read back what was extracted, in the shape the extraction module produced.
 *  Returns an empty extraction on any failure or when nothing is stored. */
export async function getSocialCredits(artistId: string): Promise<CaptionExtraction> {
    if (!artistId) return EMPTY_EXTRACTION;
    try {
        const rows = await db.select().from(artistSocialCredits)
            .where(eq(artistSocialCredits.artistId, artistId));
        const credits: CaptionCredit[] = [];
        const statements: ArtistStatement[] = [];
        for (const r of rows) {
            if (r.kind === "credit") {
                credits.push({
                    subject: r.subject ?? "",
                    isHandle: r.isHandle,
                    role: r.label,
                    quote: r.quote,
                    url: r.sourceUrl,
                    isSelf: r.isSelf,
                    postedAt: r.postedAt ?? null,
                });
            } else {
                // postedAt was stored on every row and dropped here, which is
                // why nothing downstream could answer a question about
                // "lately" — the material arrived with no sense of when.
                statements.push({
                    quote: r.quote, topic: r.label, url: r.sourceUrl,
                    postedAt: r.postedAt ?? null,
                });
            }
        }
        return { credits: credits.filter(c => c.subject), statements };
    } catch (e) {
        console.error("[getSocialCredits] Error:", e);
        return EMPTY_EXTRACTION;
    }
}

/** Whether any rows exist. NOT a completion test — an extraction that
 *  legitimately found nothing has no rows, and a half-finished one has some.
 *  Ask isResearchComplete() instead; this is only for "is there anything to
 *  show". Keeping the old name honest was worth the rename it did not get. */
export async function hasSocialCredits(artistId: string): Promise<boolean> {
    if (!artistId) return false;
    try {
        const row = await db.select({ id: artistSocialCredits.id })
            .from(artistSocialCredits)
            .where(and(eq(artistSocialCredits.artistId, artistId)))
            .limit(1);
        return row.length > 0;
    } catch (e) {
        console.error("[hasSocialCredits] Error:", e);
        return false;
    }
}


/** Post urls this artist already has a credit or statement for, so the sweep
 *  can ask only about the captions that produced nothing. */
export async function claimedSourceUrls(artistId: string): Promise<Set<string>> {
    if (!artistId) return new Set();
    try {
        const rows = await db.select({ url: artistSocialCredits.sourceUrl })
            .from(artistSocialCredits)
            .where(eq(artistSocialCredits.artistId, artistId));
        return new Set(rows.map(r => r.url));
    } catch (e) {
        console.error("[claimedSourceUrls] Error:", e);
        return new Set();
    }
}
