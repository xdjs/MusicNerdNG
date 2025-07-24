"use client";

import { useEffect, useState } from "react";
import UgcEntriesDataTable from "./UgcEntriesDataTable";
import { ugcEntryColumns, UgcEntryRow } from "./ugc-entry-columns";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

export default function UgcEntriesSection() {
  const [entries, setEntries] = useState<UgcEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entryTypeFilter, setEntryTypeFilter] = useState<string>("All");
  const [entryTypes, setEntryTypes] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/userUgcEntries")
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load");
        let data = (await res.json()) as UgcEntryRow[];
        // Replace duplicate consecutive artist names with blank string
        data = data.map((entry, idx, arr) => {
          if (idx > 0 && entry.artistName === arr[idx - 1].artistName) {
            return { ...entry, artistName: "" };
          }
          return entry;
        });
        setEntries(data);
        const types = Array.from(new Set(data.map((e) => e.siteName).filter(Boolean))) as string[];
        setEntryTypes(types);
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
      <h2 className="text-xl font-semibold text-center">Your UGC Entries</h2>

      {/* Filter */}
      <div className="flex justify-end">
        <Select value={entryTypeFilter} onValueChange={setEntryTypeFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All</SelectItem>
            {entryTypes.map((type) => (
              <SelectItem key={type} value={type}>{type}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Filtered table */}
      <UgcEntriesDataTable
        columns={ugcEntryColumns}
        data={entries.filter((e) => entryTypeFilter === "All" || e.siteName === entryTypeFilter)}
      />
    </div>
  );
} 