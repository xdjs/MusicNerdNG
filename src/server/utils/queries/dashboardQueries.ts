import { db } from "@/server/db/drizzle";
import { eq, and, sql } from "drizzle-orm";
import { artistClaims, artistVaultSources, artistBioVersions, artists } from "@/server/db/schema";

export async function getClaimByArtistId(artistId: string) {
    try {
        return await db.query.artistClaims.findFirst({
            where: eq(artistClaims.artistId, artistId),
        });
    } catch (e) {
        console.error("[getClaimByArtistId] Error:", e);
        return undefined;
    }
}

export async function getClaimById(claimId: string) {
    try {
        return await db.query.artistClaims.findFirst({
            where: eq(artistClaims.id, claimId),
        });
    } catch (e) {
        console.error("[getClaimById] Error:", e);
        return undefined;
    }
}

export async function getApprovedClaimByUserId(userId: string) {
    try {
        return await db.query.artistClaims.findFirst({
            where: and(
                eq(artistClaims.userId, userId),
                eq(artistClaims.status, "approved"),
            ),
            with: { artist: true },
        });
    } catch (e) {
        console.error("[getApprovedClaimByUserId] Error:", e);
        return undefined;
    }
}

export async function createClaim(userId: string, artistId: string, referenceCode: string) {
    try {
        const [claim] = await db
            .insert(artistClaims)
            .values({
                userId,
                artistId,
                status: "pending",
                referenceCode,
            })
            .returning();
        return claim;
    } catch (e) {
        console.error("[createClaim] Error:", e);
        throw e;
    }
}

export async function getPendingClaims() {
    try {
        return await db.query.artistClaims.findMany({
            where: eq(artistClaims.status, "pending"),
            with: { user: true, artist: true },
            orderBy: (claims, { desc }) => [desc(claims.createdAt)],
        });
    } catch (e) {
        console.error("[getPendingClaims] Error:", e);
        return [];
    }
}

// TODO: Add cursor-based pagination when claims exceed ~500 rows
// Pending claims sort first so they're never crowded out by older approved/rejected ones
export async function getAllClaims() {
    const limit = 200;
    try {
        return await db.query.artistClaims.findMany({
            with: { user: true, artist: true },
            orderBy: (claims, { asc, desc }) => [
                asc(sql`CASE WHEN ${claims.status} = 'pending' THEN 0 WHEN ${claims.status} = 'approved' THEN 1 ELSE 2 END`),
                desc(claims.createdAt),
            ],
            limit,
        });
    } catch (e) {
        console.error("[getAllClaims] Error:", e);
        return [];
    }
}

export async function approveClaim(claimId: string) {
    try {
        const [updated] = await db
            .update(artistClaims)
            .set({
                status: "approved",
                updatedAt: sql`(now() AT TIME ZONE 'utc'::text)`,
            })
            .where(eq(artistClaims.id, claimId))
            .returning();
        return updated;
    } catch (e) {
        console.error("[approveClaim] Error:", e);
        throw e;
    }
}

export async function rejectClaim(claimId: string) {
    try {
        const [updated] = await db
            .update(artistClaims)
            .set({
                status: "rejected",
                updatedAt: sql`(now() AT TIME ZONE 'utc'::text)`,
            })
            .where(eq(artistClaims.id, claimId))
            .returning();
        return updated;
    } catch (e) {
        console.error("[rejectClaim] Error:", e);
        throw e;
    }
}

export async function deleteClaim(claimId: string) {
    try {
        const [deleted] = await db
            .delete(artistClaims)
            .where(eq(artistClaims.id, claimId))
            .returning();
        return deleted;
    } catch (e) {
        console.error("[deleteClaim] Error:", e);
        throw e;
    }
}

export async function getApprovedClaimForArtistByUserId(userId: string, artistId: string) {
    try {
        return await db.query.artistClaims.findFirst({
            where: and(
                eq(artistClaims.userId, userId),
                eq(artistClaims.artistId, artistId),
                eq(artistClaims.status, "approved"),
            ),
        });
    } catch (e) {
        console.error("[getApprovedClaimForArtistByUserId] Error:", e);
        return undefined;
    }
}

export async function getPendingClaimByUserId(userId: string) {
    try {
        return await db.query.artistClaims.findFirst({
            where: and(
                eq(artistClaims.userId, userId),
                eq(artistClaims.status, "pending"),
            ),
            with: { artist: true },
        });
    } catch (e) {
        console.error("[getPendingClaimByUserId] Error:", e);
        return undefined;
    }
}

export async function getVaultSourcesByArtistId(artistId: string, status?: string) {
    try {
        if (status) {
            return await db.query.artistVaultSources.findMany({
                where: and(
                    eq(artistVaultSources.artistId, artistId),
                    eq(artistVaultSources.status, status as "pending" | "approved" | "rejected"),
                ),
                orderBy: (sources, { desc }) => [desc(sources.createdAt)],
            });
        }
        return await db.query.artistVaultSources.findMany({
            where: eq(artistVaultSources.artistId, artistId),
            orderBy: (sources, { desc }) => [desc(sources.createdAt)],
        });
    } catch (e) {
        console.error("[getVaultSourcesByArtistId] Error:", e);
        return [];
    }
}

export async function getVaultSourceByIdAndArtist(sourceId: string, artistId: string) {
    try {
        return await db.query.artistVaultSources.findFirst({
            where: and(
                eq(artistVaultSources.id, sourceId),
                eq(artistVaultSources.artistId, artistId),
            ),
        });
    } catch (e) {
        console.error("[getVaultSourceByIdAndArtist] Error:", e);
        return undefined;
    }
}

export async function getVaultSourceById(sourceId: string) {
    try {
        return await db.query.artistVaultSources.findFirst({
            where: (s, { eq }) => eq(s.id, sourceId),
        });
    } catch (e) {
        console.error("[getVaultSourceById] Error:", e);
        return undefined;
    }
}

export async function updateVaultSourceStatus(sourceId: string, status: "approved" | "rejected") {
    try {
        const [updated] = await db
            .update(artistVaultSources)
            .set({
                status,
                updatedAt: sql`(now() AT TIME ZONE 'utc'::text)`,
            })
            .where(eq(artistVaultSources.id, sourceId))
            .returning();
        return updated;
    } catch (e) {
        console.error("[updateVaultSourceStatus] Error:", e);
        throw e;
    }
}

export async function insertVaultSource(data: {
    artistId: string;
    url: string;
    title?: string;
    snippet?: string;
    type?: string;
    status?: "pending" | "approved" | "rejected";
    fileName?: string;
    fileSize?: number;
    filePath?: string;
    contentType?: string;
    extractedText?: string | null;
}) {
    try {
        const [source] = await db
            .insert(artistVaultSources)
            .values({
                artistId: data.artistId,
                url: data.url,
                title: data.title,
                snippet: data.snippet,
                type: data.type ?? "article",
                status: data.status ?? "pending",
                fileName: data.fileName,
                fileSize: data.fileSize,
                filePath: data.filePath,
                contentType: data.contentType,
                extractedText: data.extractedText,
            })
            .returning();
        return source;
    } catch (e) {
        console.error("[insertVaultSource] Error:", e);
        throw e;
    }
}

export async function deleteVaultSource(sourceId: string) {
    try {
        const [deleted] = await db
            .delete(artistVaultSources)
            .where(eq(artistVaultSources.id, sourceId))
            .returning();
        return deleted;
    } catch (e) {
        console.error("[deleteVaultSource] Error:", e);
        throw e;
    }
}

export async function updateVaultSourceType(sourceId: string, type: string) {
    try {
        const [updated] = await db
            .update(artistVaultSources)
            .set({
                type,
                updatedAt: sql`(now() AT TIME ZONE 'utc'::text)`,
            })
            .where(eq(artistVaultSources.id, sourceId))
            .returning();
        return updated;
    } catch (e) {
        console.error("[updateVaultSourceType] Error:", e);
        throw e;
    }
}

export async function deleteVaultSources(sourceIds: string[]) {
    if (sourceIds.length === 0) return [];
    try {
        const { inArray } = await import("drizzle-orm");
        const deleted = await db
            .delete(artistVaultSources)
            .where(inArray(artistVaultSources.id, sourceIds))
            .returning();
        return deleted;
    } catch (e) {
        console.error("[deleteVaultSources] Error:", e);
        throw e;
    }
}

export async function updateVaultSourceContent(sourceId: string, data: {
    title?: string;
    snippet?: string;
    extractedText?: string | null;
    ogImage?: string;
}) {
    try {
        const [updated] = await db
            .update(artistVaultSources)
            .set({
                ...(data.title !== undefined ? { title: data.title } : {}),
                ...(data.snippet !== undefined ? { snippet: data.snippet } : {}),
                ...(data.extractedText !== undefined ? { extractedText: data.extractedText } : {}),
                ...(data.ogImage !== undefined ? { ogImage: data.ogImage } : {}),
                updatedAt: sql`(now() AT TIME ZONE 'utc'::text)`,
            })
            .where(eq(artistVaultSources.id, sourceId))
            .returning();
        return updated;
    } catch (e) {
        console.error("[updateVaultSourceContent] Error:", e);
        throw e;
    }
}

export async function seedMockVaultSources(artistId: string) {
    const mockSources = [
        {
            artistId,
            url: "https://pitchfork.com/reviews/albums/example-review",
            title: "Album Review: A Deep Dive Into the Latest Release",
            snippet: "The artist's newest work pushes creative boundaries while staying true to their roots...",
            type: "review",
            status: "pending" as const,
        },
        {
            artistId,
            url: "https://rollingstone.com/music/interviews/example",
            title: "Exclusive Interview: On the Road and In the Studio",
            snippet: "We sat down with the artist to discuss their upcoming tour and creative process...",
            type: "interview",
            status: "pending" as const,
        },
        {
            artistId,
            url: "https://billboard.com/music/chart-beat/example",
            title: "Chart Analysis: Breaking Down This Week's Surprise Entry",
            snippet: "The latest single debuted at an impressive position, marking a career milestone...",
            type: "article",
            status: "pending" as const,
        },
        {
            artistId,
            url: "https://stereogum.com/features/example",
            title: "The Evolution of Sound: A Genre-Defying Journey",
            snippet: "From early bedroom recordings to sold-out arena shows, we trace the musical evolution...",
            type: "article",
            status: "pending" as const,
        },
        {
            artistId,
            url: "https://thefader.com/music/example",
            title: "Behind the Scenes: Making of the Viral Music Video",
            snippet: "The creative team shares insights into the production that captivated millions...",
            type: "review",
            status: "pending" as const,
        },
    ];

    try {
        return await db.insert(artistVaultSources).values(mockSources).returning();
    } catch (e) {
        console.error("[seedMockVaultSources] Error:", e);
        throw e;
    }
}

// ------ Bio Versions ------

export async function getBioVersionsByArtistId(artistId: string) {
    try {
        return await db.query.artistBioVersions.findMany({
            where: eq(artistBioVersions.artistId, artistId),
            orderBy: (versions, { desc }) => [desc(versions.createdAt)],
        });
    } catch (e) {
        console.error("[getBioVersionsByArtistId] Error:", e);
        return [];
    }
}

const MAX_BIO_VERSIONS = 50;

export async function saveBioVersion(artistId: string, bioText: string) {
    try {
        // All operations in a single transaction to prevent TOCTOU race on version cap
        return await db.transaction(async (tx) => {
            // Enforce version cap — delete oldest unpinned if at limit
            const existing = await tx.query.artistBioVersions.findMany({
                where: eq(artistBioVersions.artistId, artistId),
                orderBy: (v, { asc }) => [asc(v.createdAt)],
            });
            if (existing.length >= MAX_BIO_VERSIONS) {
                const oldest = existing.find(v => !v.isPinned);
                if (!oldest) {
                    throw new Error("Bio version limit reached — unpin or delete a version first");
                }
                await tx.delete(artistBioVersions).where(eq(artistBioVersions.id, oldest.id));
            }

            const [version] = await tx
                .insert(artistBioVersions)
                .values({ artistId, bioText, isPinned: false })
                .returning();
            return version;
        });
    } catch (e) {
        console.error("[saveBioVersion] Error:", e);
        throw e;
    }
}

export async function pinBioVersion(versionId: string, artistId: string) {
    try {
        // Atomic: unpin all → pin selected → update artist bio
        // Ownership is enforced by the WHERE clause (artistId match)
        return await db.transaction(async (tx) => {
            await tx
                .update(artistBioVersions)
                .set({ isPinned: false })
                .where(eq(artistBioVersions.artistId, artistId));

            const [pinned] = await tx
                .update(artistBioVersions)
                .set({ isPinned: true })
                .where(and(eq(artistBioVersions.id, versionId), eq(artistBioVersions.artistId, artistId)))
                .returning();

            if (pinned) {
                await tx
                    .update(artists)
                    .set({ bio: pinned.bioText })
                    .where(eq(artists.id, artistId));
            }

            return pinned;
        });
    } catch (e) {
        console.error("[pinBioVersion] Error:", e);
        throw e;
    }
}

export async function deleteBioVersion(versionId: string, artistId: string) {
    try {
        // Atomic check + delete to prevent TOCTOU race with concurrent pin
        return await db.transaction(async (tx) => {
            const version = await tx.query.artistBioVersions.findFirst({
                where: and(eq(artistBioVersions.id, versionId), eq(artistBioVersions.artistId, artistId)),
            });
            if (!version) return undefined;
            if (version.isPinned) throw new Error("Cannot delete a pinned bio version");

            const [deleted] = await tx
                .delete(artistBioVersions)
                .where(and(eq(artistBioVersions.id, versionId), eq(artistBioVersions.artistId, artistId)))
                .returning();
            return deleted;
        });
    } catch (e) {
        console.error("[deleteBioVersion] Error:", e);
        throw e;
    }
}
