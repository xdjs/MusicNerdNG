"use client";

import { useEffect, useState } from "react";
import UgcEntriesDataTable from "./UgcEntriesDataTable";
import { ugcEntryColumns, UgcEntryRow } from "./ugc-entry-columns";

export default function UgcEntriesSection() {
  const [entries, setEntries] = useState<UgcEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/userUgcEntries")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load");
        const data = (await res.json()) as UgcEntryRow[];
        setEntries(data);
        setLoading(false);
      })
      .catch((e) => {
        setError("Error loading entries");
        setLoading(false);
        console.error(e);
      });
  }, []);

  if (loading) {
    return <p>Loading your UGC entries...</p>;
  }

  if (error) {
    return <p className="text-red-500">{error}</p>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Your UGC Entries</h2>
      <UgcEntriesDataTable columns={ugcEntryColumns} data={entries} />
    </div>
  );
} 