"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";

export default function LeaderboardAutoRefresh() {
  const { status } = useSession();
  const prevStatus = useRef<typeof status | null>(null);

  useEffect(() => {
    const skip = sessionStorage.getItem("leaderboardSkipReload") === "true";

    if (!skip && prevStatus.current && prevStatus.current !== status && status !== "loading") {
      sessionStorage.setItem("leaderboardSkipReload", "true");
      window.location.reload();
    }

    if (skip && status !== "loading") {
      sessionStorage.removeItem("leaderboardSkipReload");
    }

    if (status !== "loading") {
      prevStatus.current = status;
    }
  }, [status]);

  return null;
} 