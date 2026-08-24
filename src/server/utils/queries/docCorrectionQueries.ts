import { db } from "@/server/db/drizzle";
import { artistDocCorrections } from "@/server/db/schema";
import { eq, and, sql } from "drizzle-orm";

export type DocCorrection = {
    id: string;
    claim: string;
    correction: string | null;
    kind: string;
};

/** Never throws: the knowledge document must still build when this table is
 *  unreachable. Losing corrections for one rebuild is recoverable; failing the
 *  rebuild leaves the artist with no document at all. */
export async function getDocCorrections(artistId: string): Promise<DocCorrection[]> {
    try {
        const rows = await db
            .select()
            .from(artistDocCorrections)
            .where(eq(artistDocCorrections.artistId, artistId));
        return rows.map(r => ({ id: r.id, claim: r.claim, correction: r.correction, kind: r.kind }));
    } catch (e) {
        console.error("[getDocCorrections] Error:", e);
        return [];
    }
}

/** Upsert on (artist, claim) — correcting the same claim twice replaces the
 *  earlier correction rather than stacking two contradictory instructions into
 *  the next rebuild. */
export async function upsertDocCorrection(
    artistId: string,
    claim: string,
    kind: "wrong" | "fix",
    correction: string | null,
): Promise<void> {
    await db
        .insert(artistDocCorrections)
        .values({ artistId, claim, kind, correction })
        .onConflictDoUpdate({
            // Matches the unique index on (artist_id, claim) from 0016.
            target: [artistDocCorrections.artistId, artistDocCorrections.claim],
            set: { kind, correction, updatedAt: sql`(now() AT TIME ZONE 'utc'::text)` },
        });
}

export async function deleteDocCorrection(artistId: string, id: string): Promise<void> {
    await db
        .delete(artistDocCorrections)
        .where(and(eq(artistDocCorrections.id, id), eq(artistDocCorrections.artistId, artistId)));
}
