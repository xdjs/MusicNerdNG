"use client";

import { useEffect } from "react";

export default function MarkUGCToastSeen() {
  useEffect(() => {
    try {
      sessionStorage.setItem("ugcToastDismissed", "1");
    } catch (_) {
      // Ignore storage errors
    }
  }, []);
  return null;
} 