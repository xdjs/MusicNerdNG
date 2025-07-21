"use client"

import { useEffect } from "react";
import { useSession } from "next-auth/react";

/**
 * Refreshes the admin page once immediately after a user successfully logs in.
 * Prevents extra refreshes by using a sessionStorage flag.
 */
export default function AdminAutoRefresh() {
  const { status } = useSession();

  useEffect(() => {
    const skip = sessionStorage.getItem("adminSkipReload") === "true";

    if (!skip && status === "authenticated") {
      sessionStorage.setItem("adminSkipReload", "true");
      // Full reload so server components pick up the new session instantly
      window.location.reload();
    }

    if (skip && status !== "loading") {
      // Clear flag once the page has stabilized
      sessionStorage.removeItem("adminSkipReload");
    }
  }, [status]);

  return null;
} 