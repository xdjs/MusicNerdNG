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
      toast({
        title: "Welcome!",
        description: session.user.name ? "Welcome back!" : "You are now signed in",
        duration: 3000,
      });
    }

    // Show a sign-out toast only when transitioning from "authenticated" to
    // "unauthenticated".
    if (prevStatus === "authenticated" && status === "unauthenticated") {
      toast({
        title: "Signed out",
        description: "You have been signed out successfully",
        duration: 3000,
      });
    }

    prevStatusRef.current = status;
  }, [status, session, toast]);

  return null;
} 