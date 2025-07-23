"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";

/**
 * Forces a one-time reload of the artist page when the user logs in so that
 * server components (e.g. the Edit button) re-render with the authenticated
 * session data. Uses sessionStorage to ensure only a single refresh.
 */
export default function ArtistAutoRefresh() {
  // Guard against missing SessionProvider in some test environments
  let status: ReturnType<typeof useSession>["status"] = "unauthenticated";
  try {
    status = useSession().status;
  } catch {
    // If SessionProvider is not in the tree (e.g., during isolated tests), skip auto-refresh logic
    return null;
  }
  const prevStatus = useRef<typeof status | null>(null);

  useEffect(() => {
    const skip = sessionStorage.getItem("artistSkipReload") === "true";

    if (!skip && prevStatus.current && prevStatus.current !== status && status !== "loading") {
      sessionStorage.setItem("artistSkipReload", "true");
      window.location.reload();
    }

    if (skip && status !== "loading") {
      sessionStorage.removeItem("artistSkipReload");
    }

    if (status !== "loading") {
      prevStatus.current = status;
    }
  }, [status]);

  return null;
} 