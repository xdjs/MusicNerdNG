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
export async function replaceSocialCredits(
    artistId: string,
    extraction: CaptionExtraction,
    postedAtByUrl?: Map<string, string | null>,
): Promise<number> {
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
        await db.delete(artistSocialCredits).where(eq(artistSocialCredits.artistId, artistId));
        if (rows.length === 0) return 0;
        await db.insert(artistSocialCredits).values(rows).onConflictDoNothing();
        return rows.length;
    } catch (e) {
        console.error("[replaceSocialCredits] Error:", e);
        return 0;
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
                });
            } else {
                statements.push({ quote: r.quote, topic: r.label, url: r.sourceUrl });
            }
        }
        return { credits: credits.filter(c => c.subject), statements };
    } catch (e) {
        console.error("[getSocialCredits] Error:", e);
        return EMPTY_EXTRACTION;
    }
}

/** True when this artist's captions have already been read. Lets the ingest
 *  skip a re-extraction it does not need. */
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
