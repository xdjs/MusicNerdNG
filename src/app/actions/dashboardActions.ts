"use server"

import { getServerAuthSession } from "@/server/auth";
import { getDevSession } from "@/server/utils/dev-auth";
import type { ArtistVaultSource } from "@/server/db/DbTypes";
import {
    createClaim,
    getClaimByArtistId,
    getApprovedClaimByUserId,
    getVaultSourcesByArtistId,
    getVaultSourceById,
    updateVaultSourceStatus,
    updateVaultSourceType,
    insertVaultSource,
    deleteVaultSource,
    deleteVaultSources,
    getBioVersionsByArtistId,
    saveBioVersion,
    pinBioVersion,
    deleteBioVersion,
} from "@/server/utils/queries/dashboardQueries";
import { inferTypeFromUrl, SOURCE_TYPES } from "@/lib/sourceTypes";
import { searchAndPopulateVault } from "@/server/utils/queries/vaultWebSearch";
import { generateArtistBio } from "@/server/utils/queries/artistBioQuery";
import { fetchPageContent, isUnsafeUrl } from "@/server/utils/fetchPageContent";
import { updateVaultSourceContent } from "@/server/utils/queries/dashboardQueries";
import { generateReferenceCode } from "@/lib/referenceCode";
import { sendDiscordMessage } from "@/server/utils/queries/discord";
import { canEditArtist } from "@/server/utils/artistEditAuth";
import { MAX_BIO_LENGTH } from "@/lib/bioConstants";

// Best-effort debounce for bio regen (same serverless caveat as rate limiting).
// Map is module-level — on long-lived workers (e.g. self-hosted Node) it would
// grow unbounded without the prune below. Soft-cap + TTL drop keeps it bounded.
//
// Prune fires only on the WRITE path (right before set()), not on read. On a quiet
// worker that always hits the debounce for the same small set of artists, the map
// is small and prune is unnecessary. On a busy worker, every new artist write goes
// through this prune, so growth is naturally rate-limited. A separate timer/sweeper
// would just burn cycles on idle workers and add coordination overhead — write-time
// prune is the right shape for best-effort serverless state.
const bioRegenTimestamps = new Map<string, number>();
const BIO_REGEN_DEBOUNCE_MS = 30_000;
const BIO_REGEN_MAP_SOFT_CAP = 5_000;
function pruneBioRegenTimestamps(now: number): void {
    if (bioRegenTimestamps.size <= BIO_REGEN_MAP_SOFT_CAP) return;
    // First pass: drop entries older than 2× the debounce window — those can't
    // possibly affect a debounce decision anymore.
    const cutoff = now - BIO_REGEN_DEBOUNCE_MS * 2;
    for (const [k, t] of bioRegenTimestamps) {
        if (t < cutoff) bioRegenTimestamps.delete(k);
    }
    // Belt and suspenders: if a worker somehow racked up 5k regenerations inside
    // a single debounce window, nuke the whole map. Worst case is one extra regen
    // per artist on the next request — best-effort debounce, by design.
    if (bioRegenTimestamps.size > BIO_REGEN_MAP_SOFT_CAP) bioRegenTimestamps.clear();
}

export async function claimArtistProfile(artistId: string): Promise<{ success: boolean; error?: string; alreadyClaimed?: boolean; referenceCode?: string }> {
    const session = await getServerAuthSession() ?? await getDevSession();
    if (!session) return { success: false, error: "Not authenticated" };

    try {
        // getClaimByArtistId is scoped to ACTIVE claims (pending|approved) since
        // migration 0007 — rejected claims persist for audit but never block
        // re-claim. No need to delete-then-insert anymore.
        const existing = await getClaimByArtistId(artistId);
        if (existing) {
            return { success: false, alreadyClaimed: true, error: "This artist profile has already been claimed" };
        }

        const referenceCode = generateReferenceCode();
        await createClaim(session.user.id, artistId, referenceCode);

        // Notify admins via Discord
        sendDiscordMessage(
            `New claim request: ${referenceCode} | Artist ID: ${artistId} | User: ${session.user.email ?? session.user.id}`
        ).catch(e => console.error("[claimArtistProfile] Discord notify failed:", e));

        return { success: true, referenceCode };
    } catch (error) {
        console.error("[claimArtistProfile] Error:", error);
        return { success: false, error: "Failed to claim artist profile" };
    }
}

/** Resolve a source the user may edit: admins can edit any source, owners only their claimed artist's. Returns the source's artistId. */
async function verifySourceEditable(userId: string, sourceId: string) {
    const source = await getVaultSourceById(sourceId);
    if (!source) return { authorized: false as const, error: "Source not found" };
    if (await canEditArtist(userId, source.artistId)) {
        return { authorized: true as const, artistId: source.artistId };
    }
    return { authorized: false as const, error: "Not authorized for this source" };
}

/** Authorize editing a specific artist: admins may edit any, owners only their claimed artist. */
async function verifyArtistEditable(userId: string, artistId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    return (await canEditArtist(userId, artistId)) ? { ok: true } : { ok: false, error: "Not authorized for this artist" };
}

export async function updateSourceStatus(
    sourceId: string,
    status: "approved" | "rejected"
): Promise<{ success: boolean; error?: string }> {
    const session = await getServerAuthSession() ?? await getDevSession();
    if (!session) return { success: false, error: "Not authenticated" };

    try {
        const ownership = await verifySourceEditable(session.user.id, sourceId);
        if (!ownership.authorized) return { success: false, error: ownership.error };

        await updateVaultSourceStatus(sourceId, status);

        // Regenerate bio in the background when a source is approved (debounced)
        if (status === "approved" && ownership.artistId) {
            const now = Date.now();
            const lastRegen = bioRegenTimestamps.get(ownership.artistId) ?? 0;
            if (now - lastRegen > BIO_REGEN_DEBOUNCE_MS) {
                pruneBioRegenTimestamps(now);
                bioRegenTimestamps.set(ownership.artistId, now);
                Promise.resolve(generateArtistBio(ownership.artistId)).catch(e =>
                    console.error("[updateSourceStatus] Background bio regeneration failed:", e)
                );
            } else {
                console.log(`[updateSourceStatus] Skipping bio regen for ${ownership.artistId} — debounced`);
            }
        }

        return { success: true };
    } catch (error) {
        console.error("[updateSourceStatus] Error:", error);
        return { success: false, error: "Failed to update source status" };
    }
}

export async function searchWebForSources(artistId: string): Promise<{ success: boolean; count?: number; sources?: ArtistVaultSource[]; error?: string }> {
    const session = await getServerAuthSession() ?? await getDevSession();
    if (!session) return { success: false, error: "Not authenticated" };

    try {
        const auth = await verifyArtistEditable(session.user.id, artistId);
        if (!auth.ok) return { success: false, error: auth.error };

        const sources = await searchAndPopulateVault(artistId);
        return { success: true, count: sources.length, sources };
    } catch (error) {
        console.error("[searchWebForSources] Error:", error);
        return { success: false, error: "Failed to search for sources" };
    }
}

export async function addVaultSource(
    artistId: string,
    url: string
): Promise<{ success: boolean; error?: string }> {
    const session = await getServerAuthSession() ?? await getDevSession();
    if (!session) return { success: false, error: "Not authenticated" };

    try {
        const auth = await verifyArtistEditable(session.user.id, artistId);
        if (!auth.ok) return { success: false, error: auth.error };

        // Reject non-http(s) schemes (javascript:, data:, file:, etc.) and private/local hosts.
        // URLs are rendered as <a href> on the public artist page — unsafe schemes would be stored XSS.
        if (isUnsafeUrl(url)) {
            return { success: false, error: "URL must be a public http or https address" };
        }

        // Insert immediately with domain-based title, then fetch content in background
        let title = "Untitled Source";
        try {
            const parsed = new URL(url);
            title = `Source from ${parsed.hostname.replace("www.", "")}`;
        } catch {
            // malformed URL — use default title
        }

        const source = await insertVaultSource({
            artistId,
            url,
            title,
            type: inferTypeFromUrl(url),
            status: "pending",
        });

        // Fire background content fetch to populate real title/snippet/extractedText
        if (source?.id) {
            fetchPageContent(url).then(content => {
                updateVaultSourceContent(source.id, {
                    title: content.title,
                    snippet: content.snippet,
                    extractedText: content.extractedText,
                    ogImage: content.ogImage,
                }).catch(e => console.error("[addVaultSource] Background content update failed:", e));
            }).catch(e => console.error("[addVaultSource] Background fetch failed:", e));
        }

        return { success: true };
    } catch (error) {
        console.error("[addVaultSource] Error:", error);
        return { success: false, error: "Failed to add source" };
    }
}

export async function updateSourceType(
    sourceId: string,
    type: string
): Promise<{ success: boolean; error?: string }> {
    const session = await getServerAuthSession() ?? await getDevSession();
    if (!session) return { success: false, error: "Not authenticated" };

    if (!SOURCE_TYPES.includes(type as typeof SOURCE_TYPES[number])) {
        return { success: false, error: "Invalid source type" };
    }

    try {
        const ownership = await verifySourceEditable(session.user.id, sourceId);
        if (!ownership.authorized) return { success: false, error: ownership.error };

        await updateVaultSourceType(sourceId, type);
        return { success: true };
    } catch (error) {
        console.error("[updateSourceType] Error:", error);
        return { success: false, error: "Failed to update source type" };
    }
}

export async function removeVaultSource(
    sourceId: string
): Promise<{ success: boolean; error?: string }> {
    const session = await getServerAuthSession() ?? await getDevSession();
    if (!session) return { success: false, error: "Not authenticated" };

    try {
        const ownership = await verifySourceEditable(session.user.id, sourceId);
        if (!ownership.authorized) return { success: false, error: ownership.error };

        await deleteVaultSource(sourceId);
        return { success: true };
    } catch (error) {
        console.error("[removeVaultSource] Error:", error);
        return { success: false, error: "Failed to delete source" };
    }
}

export async function removeVaultSources(
    sourceIds: string[]
): Promise<{ success: boolean; count?: number; error?: string }> {
    const session = await getServerAuthSession() ?? await getDevSession();
    if (!session) return { success: false, error: "Not authenticated" };

    try {
        if (sourceIds.length === 0) return { success: true, count: 0 };

        // Multi-claim-safe: resolve each source's artist directly, then verify the
        // user may edit THAT specific artist (admin or claimant). Previously this
        // path used getApprovedClaimByUserId (single-claim) which would silently
        // misbehave if a user ever held two approved claims — sources for the
        // "wrong" artist would either be rejected or, worse, operated on under
        // an unrelated claim.
        const sources = await Promise.all(
            sourceIds.map(id => getVaultSourceById(id))
        );

        const missing = sources.findIndex(s => !s);
        if (missing >= 0) {
            return { success: false, error: "One or more sources not found" };
        }

        const artistIds = [...new Set(sources.map(s => s!.artistId))];
        const authz = await Promise.all(
            artistIds.map(id => canEditArtist(session.user.id, id))
        );
        if (authz.some(ok => !ok)) {
            return { success: false, error: "Not authorized for one or more sources" };
        }

        const deleted = await deleteVaultSources(sourceIds);
        return { success: true, count: deleted.length };
    } catch (error) {
        console.error("[removeVaultSources] Error:", error);
        return { success: false, error: "Failed to delete sources" };
    }
}

// ------ Bio Versions ------

export async function getArtistBioVersions(targetArtistId?: string): Promise<{ success: boolean; versions?: Awaited<ReturnType<typeof getBioVersionsByArtistId>>; error?: string }> {
    const session = await getServerAuthSession() ?? await getDevSession();
    if (!session) return { success: false, error: "Not authenticated" };

    try {
        const resolved = await resolveBioArtistId(session.user.id, targetArtistId);
        if ("error" in resolved) return { success: false, error: resolved.error };

        const versions = await getBioVersionsByArtistId(resolved.artistId);
        return { success: true, versions };
    } catch (error) {
        console.error("[getArtistBioVersions] Error:", error);
        return { success: false, error: "Failed to load bio versions" };
    }
}

export async function saveCurrentBio(bioText: string, targetArtistId?: string): Promise<{ success: boolean; error?: string }> {
    const session = await getServerAuthSession() ?? await getDevSession();
    if (!session) return { success: false, error: "Not authenticated" };

    if (!bioText || bioText.length > MAX_BIO_LENGTH) {
        return { success: false, error: `Bio must be between 1 and ${MAX_BIO_LENGTH} characters` };
    }

    try {
        const resolved = await resolveBioArtistId(session.user.id, targetArtistId);
        if ("error" in resolved) return { success: false, error: resolved.error };

        await saveBioVersion(resolved.artistId, bioText);
        return { success: true };
    } catch (error) {
        console.error("[saveCurrentBio] Error:", error);
        const message = error instanceof Error ? error.message : "Failed to save bio";
        return { success: false, error: message };
    }
}

/** Resolve the artistId for bio version actions — admin can target any artist via the version's owner */
async function resolveBioArtistId(userId: string, targetArtistId?: string): Promise<{ artistId: string } | { error: string }> {
    if (targetArtistId) {
        if (await canEditArtist(userId, targetArtistId)) return { artistId: targetArtistId };
        return { error: "Not authorized for this artist" };
    }
    const claim = await getApprovedClaimByUserId(userId);
    if (!claim) return { error: "No claimed artist profile" };
    return { artistId: claim.artistId };
}

export async function pinBioVersionAction(versionId: string, targetArtistId?: string): Promise<{ success: boolean; error?: string }> {
    const session = await getServerAuthSession() ?? await getDevSession();
    if (!session) return { success: false, error: "Not authenticated" };

    try {
        const resolved = await resolveBioArtistId(session.user.id, targetArtistId);
        if ("error" in resolved) return { success: false, error: resolved.error };

        const pinned = await pinBioVersion(versionId, resolved.artistId);
        if (!pinned) return { success: false, error: "Bio version not found" };
        return { success: true };
    } catch (error) {
        console.error("[pinBioVersionAction] Error:", error);
        return { success: false, error: "Failed to pin bio version" };
    }
}

export async function deleteBioVersionAction(versionId: string, targetArtistId?: string): Promise<{ success: boolean; error?: string }> {
    const session = await getServerAuthSession() ?? await getDevSession();
    if (!session) return { success: false, error: "Not authenticated" };

    try {
        const resolved = await resolveBioArtistId(session.user.id, targetArtistId);
        if ("error" in resolved) return { success: false, error: resolved.error };

        const deleted = await deleteBioVersion(versionId, resolved.artistId);
        if (!deleted) return { success: false, error: "Bio version not found" };
        return { success: true };
    } catch (error) {
        console.error("[deleteBioVersionAction] Error:", error);
        const message = error instanceof Error ? error.message : "Failed to delete bio version";
        return { success: false, error: message };
    }
}
