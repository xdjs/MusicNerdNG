import { getUserById } from "@/server/utils/queries/userQueries";
import { getApprovedClaimForArtistByUserId } from "@/server/utils/queries/dashboardQueries";

/**
 * Single source of truth for "may this user directly edit this artist?":
 * the approved claimant of THIS artist, or an admin.
 *
 * Claim-for-artist is checked first (one indexed lookup) so the common owner
 * path skips the users lookup. Uses the per-artist claim query so it is correct
 * even if a user ever holds multiple approved claims.
 */
export async function canEditArtist(userId: string, artistId: string): Promise<boolean> {
  const claim = await getApprovedClaimForArtistByUserId(userId, artistId);
  if (claim) return true;
  const user = await getUserById(userId);
  return !!user?.isAdmin;
}
