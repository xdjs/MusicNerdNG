"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useToast } from "@/hooks/use-toast";

export default function AuthToast() {
  const { data: session, status } = useSession();
  const { toast } = useToast();
  
  // Keep track of the previous auth status so we only fire toasts
  // when the status actually changes.
  const prevStatusRef = useRef<typeof status>(status);
  const isFirstRunRef = useRef(true);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;

    // Skip the very first run to avoid showing a welcome toast on page reload
    if (isFirstRunRef.current) {
      isFirstRunRef.current = false;
      prevStatusRef.current = status;
      return;
    }

    // Show a welcome toast only when transitioning into "authenticated" from any
    // other state (after the initial mount), with a valid user object.
    if (prevStatus !== "authenticated" && status === "authenticated" && session?.user) {
      // Check if the user has any recently-approved UGC (last 24 h).
      let approvedToastDismissedThisSession = false;
      if (typeof window !== "undefined") {
        approvedToastDismissedThisSession = sessionStorage.getItem("ugcToastDismissed") === "1";
      }
      (async () => {
        try {
          const resp = await fetch("/api/recentEdited");
          if (resp.ok) {
            const data = await resp.json();
            if (Array.isArray(data) && data.length > 0) {
              const oneDayMs = 24 * 60 * 60 * 1000;
              const now = Date.now();
              const hasRecent = data.some((row: any) => {
                if (!row?.updatedAt) return false;
                const ts = new Date(row.updatedAt).getTime();
                return now - ts <= oneDayMs;
              });

              if (hasRecent && !approvedToastDismissedThisSession) {
                toast({
                  title: "Welcome!",
                  description: "Your recently added UGC has been approved.",
                  duration: 5000,
                });
                return;
              }
            }
          }
        } catch (_) {
          // Ignore errors – we'll fall back to the generic toast
        }

        // Default welcome toast (no newly-approved UGC or fetch error)
        toast({
          title: "Welcome!",
          description: session.user.name ? "Welcome back!" : "You are now signed in",
          duration: 3000,
        });
      })();
    }

    // Show a sign-out toast only when transitioning from "authenticated" to
    // "unauthenticated".
    if (prevStatus === "authenticated" && status === "unauthenticated") {
      toast({
        title: "Signed out",
        description: "You have been signed out successfully",
        duration: 3000,
      });
      // Reset dismissal flag so the toast can appear on next login
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("ugcToastDismissed");
      }
    }

    prevStatusRef.current = status;
  }, [status, session, toast]);

  return null;
} 