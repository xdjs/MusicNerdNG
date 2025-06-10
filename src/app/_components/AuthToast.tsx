"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useToast } from "@/hooks/use-toast";

export default function AuthToast() {
  const { data: session, status } = useSession();
  const { toast } = useToast();
  
  useEffect(() => {
    if (status === "authenticated" && session?.user) {
      toast({
        title: "Welcome!",
        description: session.user.name ? `Welcome back!` : "You are now signed in",
        duration: 3000,
      });
    } else if (status === "unauthenticated") {
      // Only show logout toast if we were previously authenticated
      // This prevents showing the toast on initial page load
      if (typeof window !== "undefined" && sessionStorage.getItem("wasAuthenticated")) {
        toast({
          title: "Signed out",
          description: "You have been signed out successfully",
          duration: 3000,
        });
      }
    }
    
    // Keep track of authentication state for logout toast
    if (status === "authenticated") {
      sessionStorage.setItem("wasAuthenticated", "true");
    } else if (status === "unauthenticated") {
      sessionStorage.removeItem("wasAuthenticated");
    }
  }, [status, session, toast]);

  return null;
} 