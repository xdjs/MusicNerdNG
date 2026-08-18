"use server"

import { getServerAuthSession } from "@/server/auth";
import { getUserById } from "@/server/utils/queries/userQueries";
import { approveClaim, rejectClaim, getAllClaims, getClaimById, revokeApprovedClaim } from "@/server/utils/queries/dashboardQueries";
import { searchAndPopulateVault } from "@/server/utils/queries/vaultWebSearch";
import { sendDiscordMessage } from "@/server/utils/queries/discord";
import { sendClaimApprovedEmail } from "@/server/utils/email";
import { getArtistById } from "@/server/utils/queries/artistQueries";
import { logMcpAudit } from "@/app/api/mcp/audit";
import { getSupabaseAdmin, VAULT_BUCKET } from "@/server/lib/supabase";

async function requireAdminSession() {
    const session = await getServerAuthSession();
    if (!session?.user?.id) return null;
    const user = await getUserById(session.user.id);
    if (!user?.isAdmin) return null;
    return session;
}

export async function getAdminAllClaims() {
    const session = await requireAdminSession();
    if (!session) return [];
    return getAllClaims();
}

export async function approveClaimAction(claimId: string): Promise<{ success: boolean; error?: string }> {
    const session = await requireAdminSession();
    if (!session) return { success: false, error: "Not authorized" };

    try {
        const claim = await approveClaim(claimId);
        if (!claim) return { success: false, error: "Claim not found" };

        searchAndPopulateVault(claim.artistId).catch(e =>
            console.error("[approveClaimAction] Background web search failed:", e)
        );

        // Approval email — AWAITED (not fire-and-forget). On Vercel a serverless
        // lambda can freeze immediately after the action returns, so a floating
        // promise here may never actually send. sendEmail/sendClaimApprovedEmail
        // are documented to never throw, but the try/catch here is defense in
        // depth anyway: approval must NEVER fail because of email, and it already
        // committed to the DB above. The null-email guard still skips legacy
        // wallet users. The on-page banner remains the fallback channel either way.
        try {
            const [claimUser, artist] = await Promise.all([
                getUserById(claim.userId),
                getArtistById(claim.artistId),
            ]);
            if (!claimUser?.email) {
                console.log(`[approveClaimAction] No email for user ${claim.userId} — skipping approval email`);
            } else {
                await sendClaimApprovedEmail(claimUser.email, artist?.name ?? null, claim.artistId);
            }
        } catch (e) {
            console.error("[approveClaimAction] Approval email failed:", e);
        }

        sendDiscordMessage(
            `Claim APPROVED: ${claim.referenceCode} | Artist ID: ${claim.artistId} | Approved by: ${session.user.email ?? session.user.id}`
        ).catch(e => console.error("[approveClaimAction] Discord notify failed:", e));

        return { success: true };
    } catch (error) {
        console.error("[approveClaimAction] Error:", error);
        return { success: false, error: "Failed to approve claim" };
    }
}

export async function rejectClaimAction(claimId: string): Promise<{ success: boolean; error?: string }> {
    const session = await requireAdminSession();
    if (!session) return { success: false, error: "Not authorized" };

    try {
        const claim = await rejectClaim(claimId);
        if (!claim) return { success: false, error: "Claim not found" };

        sendDiscordMessage(
            `Claim REJECTED: ${claim.referenceCode} | Artist ID: ${claim.artistId} | Rejected by: ${session.user.email ?? session.user.id}`
        ).catch(e => console.error("[rejectClaimAction] Discord notify failed:", e));

        return { success: true };
    } catch (error) {
        console.error("[rejectClaimAction] Error:", error);
        return { success: false, error: "Failed to reject claim" };
    }
}

/** Hard-deletes the claim row and wipes the artist's vault (DB rows + Storage objects).
 *  Intentional — allows the artist to be re-claimed by someone else without inheriting
 *  the previous owner's uploaded files or press links. Audit persisted + Discord. */
export async function revokeClaimAction(claimId: string): Promise<{ success: boolean; error?: string }> {
    const session = await requireAdminSession();
    if (!session) return { success: false, error: "Not authorized" };

    try {
        // Preflight for friendlier errors. The transaction below re-checks status='approved'
        // so a race between preflight and commit can only make revoke fail, never succeed on
        // the wrong state.
        const existing = await getClaimById(claimId);
        if (!existing) return { success: false, error: "Claim not found" };
        if (existing.status !== "approved") return { success: false, error: "Can only revoke approved claims" };

        // Atomic: delete vault sources + claim in one transaction.
        const claim = await revokeApprovedClaim(claimId);
        if (!claim) return { success: false, error: "Claim is no longer approved" };

        // Best-effort: purge uploaded files from Supabase Storage. Runs after the DB tx
        // commits — orphaned storage objects beat a failed revoke. Two prefixes to clean:
        //   1. `${artistId}/...`              — vault uploads (vault/upload route)
        //   2. `profile-images/${artistId}_*` — claim profile image (artist/profile-image route)
        // Paginated so artists with >100 files (supabase-js list default limit) are fully purged.
        try {
            const supa = getSupabaseAdmin();
            const PAGE_SIZE = 1000;
            const MAX_ITERATIONS = 100; // safety ceiling — 100k files would be absurd

            // Pass 1: vault folder (everything under `${artistId}/`)
            let vaultRemoved = 0;
            for (let i = 0; i < MAX_ITERATIONS; i++) {
                const { data: files, error: listError } = await supa.storage
                    .from(VAULT_BUCKET)
                    .list(claim.artistId, { limit: PAGE_SIZE, offset: 0 });
                if (listError) {
                    console.error("[revokeClaimAction] Vault list failed:", listError);
                    break;
                }
                if (!files || files.length === 0) break;

                const paths = files.map(f => `${claim.artistId}/${f.name}`);
                const { error: removeError } = await supa.storage
                    .from(VAULT_BUCKET)
                    .remove(paths);
                if (removeError) {
                    console.error("[revokeClaimAction] Vault remove failed:", removeError);
                    break;
                }
                vaultRemoved += files.length;

                // Short page → no more results. remove() shifted the listing, so we
                // always re-read from offset 0; no offset advance needed.
                if (files.length < PAGE_SIZE) break;

                if (i === MAX_ITERATIONS - 1) {
                    console.error(`[revokeClaimAction] Vault purge hit iteration ceiling (${MAX_ITERATIONS}) for artist ${claim.artistId} — remaining files orphaned`);
                }
            }

            // Pass 2: profile-images folder, filtered to this artist's prefix only
            // (profile-images/ is shared across all artists — must NOT remove others').
            const profilePrefix = `${claim.artistId}_`;
            let profileRemoved = 0;
            for (let i = 0; i < MAX_ITERATIONS; i++) {
                const { data: files, error: listError } = await supa.storage
                    .from(VAULT_BUCKET)
                    .list("profile-images", { limit: PAGE_SIZE, offset: 0, search: profilePrefix });
                if (listError) {
                    console.error("[revokeClaimAction] Profile-images list failed:", listError);
                    break;
                }
                if (!files || files.length === 0) break;

                // Defense in depth: `search` is a substring match — re-filter on the prefix
                // so an artist whose UUID happens to appear inside another file's name can't
                // cross-delete. (UUID collisions in mid-name are vanishingly unlikely, but cheap.)
                const ownFiles = files.filter(f => f.name.startsWith(profilePrefix));
                if (ownFiles.length === 0) {
                    // All search hits were substring-collisions, not real matches. Bail out —
                    // if there really is an own-prefix file on a later page, we won't find it
                    // here (we'd need to advance offset past this page), but that scenario
                    // would require 1000+ unrelated names embedding this artist's UUID, which
                    // is effectively impossible. Logged for observability if it ever happens.
                    if (files.length === PAGE_SIZE) {
                        console.warn(`[revokeClaimAction] Profile-images search page had ${files.length} substring-only hits for ${claim.artistId} — bailing without checking subsequent pages`);
                    }
                    break;
                }

                const paths = ownFiles.map(f => `profile-images/${f.name}`);
                const { error: removeError } = await supa.storage
                    .from(VAULT_BUCKET)
                    .remove(paths);
                if (removeError) {
                    console.error("[revokeClaimAction] Profile-images remove failed:", removeError);
                    break;
                }
                profileRemoved += ownFiles.length;

                if (files.length < PAGE_SIZE) break;

                if (i === MAX_ITERATIONS - 1) {
                    console.error(`[revokeClaimAction] Profile-images purge hit iteration ceiling (${MAX_ITERATIONS}) for artist ${claim.artistId} — remaining files orphaned`);
                }
            }

            if (vaultRemoved + profileRemoved > 0) {
                console.log(`[revokeClaimAction] Purged ${vaultRemoved} vault + ${profileRemoved} profile-image objects for artist ${claim.artistId}`);
            }
        } catch (e) {
            console.error("[revokeClaimAction] Storage cleanup error:", e);
        }

        // Persist audit before Discord (DB is more reliable than webhook)
        // apiKeyHash uses "admin:<userId>" convention for admin-initiated actions
        // (distinct from MCP SHA-256 key hashes which are hex strings)
        logMcpAudit({
            artistId: claim.artistId,
            field: "claim",
            action: "delete",
            oldValue: `${claim.status}|${claim.referenceCode}`,
            newValue: null,
            apiKeyHash: `admin:${session.user.id}`,
        }).catch(e => console.error("[revokeClaimAction] Audit log failed:", e));

        sendDiscordMessage(
            `Claim REVOKED: ${claim.referenceCode} | Artist ID: ${claim.artistId} | Revoked by: ${session.user.email ?? session.user.id}`
        ).catch(e => console.error("[revokeClaimAction] Discord notify failed:", e));

        return { success: true };
    } catch (error) {
        console.error("[revokeClaimAction] Error:", error);
        return { success: false, error: "Failed to revoke claim" };
    }
}
