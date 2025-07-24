"use client";

import { useEffect, useMemo, useState } from "react";
import UgcEntriesDataTable from "./UgcEntriesDataTable";
import { UgcEntryRow } from "./ugc-entry-columns";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

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

  const columns = useMemo<ColumnDef<UgcEntryRow>[]>(() => {
    const formatDate = (val: string | Date | null | undefined) => {
      if (!val) return "";
      const dateObj = val instanceof Date ? val : new Date(val);
      return dateObj.toLocaleDateString();
    };
    const formatTime = (val: string | Date | null | undefined) => {
      if (!val) return "";
      const dateObj = val instanceof Date ? val : new Date(val);
      return dateObj.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
    };
    return [
      // Date column
      {
        accessorKey: "createdAt",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="px-0"
          >
            Date
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ getValue }) => formatDate(getValue() as any),
      },
      // Time column
      {
        id: "time",
        header: "Time",
        accessorFn: (row) => row.createdAt,
        cell: ({ getValue }) => formatTime(getValue() as any),
      },
      // Artist
      {
        accessorKey: "artistName",
        header: "Artist",
        cell: ({ getValue }) => getValue() || "",
      },
      // Entry Type with filter dropdown in header
      {
        accessorKey: "siteName",
        header: () => (
          <div className="flex items-center gap-2">
            <span>Entry Type</span>
            <Select value={entryTypeFilter} onValueChange={setEntryTypeFilter}>
              <SelectTrigger className="h-6 w-28 text-xs px-2 py-0.5">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All</SelectItem>
                {entryTypes.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ),
        cell: ({ getValue }) => getValue() as string,
      },
      // Site link
      {
        accessorKey: "ugcUrl",
        header: "Site Link",
        cell: ({ getValue }) => {
          const url = getValue() as string | null;
          return url ? (
            <Link href={url} target="_blank" rel="noopener noreferrer" className="underline text-blue-600 hover:text-blue-800 text-xs">
              View
            </Link>
          ) : (
            "—"
          );
        },
      },
      // Status
      {
        id: "status",
        header: "Status",
        accessorFn: (row) => (row.accepted ? "Approved" : "Pending"),
      },
    ];
  }, [entryTypeFilter, entryTypes]);

  if (loading) return <p>Loading your UGC entries...</p>;
  if (error) return <p className="text-red-500">{error}</p>;

  const filtered = entries.filter((e) => entryTypeFilter === "All" || e.siteName === entryTypeFilter);

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold text-center">Your UGC Entries</h2>
      <UgcEntriesDataTable columns={columns} data={filtered} />
    </div>
  );
} 