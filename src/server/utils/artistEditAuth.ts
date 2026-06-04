import { getUserById } from "@/server/utils/queries/userQueries";
import { getApprovedClaimForArtistByUserId } from "@/server/utils/queries/dashboardQueries";

// May this user directly edit this artist? Approved claimant of this artist (claim-first, multi-claim-safe), or admin.
export async function canEditArtist(userId: string, artistId: string): Promise<boolean> {
  const claim = await getApprovedClaimForArtistByUserId(userId, artistId);
  if (claim) return true;
  const user = await getUserById(userId);
  return !!user?.isAdmin;
}
