"use client";

import { useEffect } from "react";

export default function MarkUGCToastSeen() {
  useEffect(() => {
    const today = new Date().toISOString().split("T")[0];
    try {
      localStorage.setItem("ugcToastDismissedDate", today);
    } catch (_) {
      // Ignore storage errors
    }
  }, []);
  return null;
} 