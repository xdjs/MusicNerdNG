"use server";

// Server-action wrappers around heavy query helpers so that client components can call them safely.
// Only tiny re-exports here – all logic lives in src/server/utils/queries/**

import {
  approveUgcAdmin as approveUgcAdminQuery,
  addArtistData as addArtistDataQuery,
  AddArtistDataResp,
  AddArtistResp,
} from "@/server/utils/queries/artistQueries";

import {
  searchForUsersByWallet as searchForUsersByWalletQuery,
  addUsersToWhitelist as addUsersToWhitelistQuery,
  removeFromWhitelist as removeFromWhitelistQuery,
} from "@/server/utils/queries/userQueries";

import {
  getUgcStatsInRange as getUgcStatsInRangeQuery,
  LeaderboardEntry,
} from "@/server/utils/queries/leaderboardQueries";

// ---- Types re-exported for client files ----
export type { AddArtistDataResp, AddArtistResp, LeaderboardEntry };

// ---- Wrapped functions (actions) ----
export async function approveUgcAdminAction(ugcIds: string[]) {
  return approveUgcAdminQuery(ugcIds);
}

export async function addArtistDataAction(url: string, artist: Parameters<typeof addArtistDataQuery>[1]) {
  return addArtistDataQuery(url, artist);
}

export async function searchForUsersByWalletAction(wallet: string) {
  return searchForUsersByWalletQuery(wallet);
}

export async function addUsersToWhitelistAction(wallets: string[]) {
  return addUsersToWhitelistQuery(wallets);
}

export async function removeFromWhitelistAction(userIds: string[]) {
  return removeFromWhitelistQuery(userIds);
}

export async function getUgcStatsInRangeAction(
  date: Parameters<typeof getUgcStatsInRangeQuery>[0],
  wallet: string | null = null,
) {
  return getUgcStatsInRangeQuery(date, wallet);
} 