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
    let attempts = 0;
    const fetchEntries = async () => {
      try {
        attempts++;
        const res = await fetch("/api/userUgcEntries");
        if (!res.ok) throw new Error("Request failed");
        let data = (await res.json()) as UgcEntryRow[];

        // Sort by createdAt DESC (newest first)
        data.sort((a, b) => {
          const ta = new Date(a.createdAt || '').getTime();
          const tb = new Date(b.createdAt || '').getTime();
          return tb - ta;
        });
        setEntries(data);
        const types = Array.from(new Set(data.map((e) => e.siteName).filter(Boolean))) as string[];
        setEntryTypes(types);
        setLoading(false);
      } catch (e) {
        if (attempts < 3) {
          setTimeout(fetchEntries, 1000);
        } else {
          setError("Error loading entries");
          setLoading(false);
          console.error(e);
        }
      }
    };
    fetchEntries();
  }, []);

  const columns = useMemo<ColumnDef<UgcEntryRow>[]>(() => {
    const toLocalDate = (val: string | Date) => {
      // If val is ISO string without timezone, treat as UTC
      if (typeof val === "string" && !val.endsWith("Z")) {
        return new Date(val + "Z");
      }
      return val instanceof Date ? val : new Date(val);
    };

    const formatDate = (val: string | Date | null | undefined) => {
      if (!val) return "";
      const dateObj = toLocalDate(val);
      return dateObj.toLocaleDateString();
    };
    const formatTime = (val: string | Date | null | undefined) => {
      if (!val) return "";
      const dateObj = toLocalDate(val);
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
          <div className="flex items-center justify-center gap-2 w-full">
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
      // Status with colored dot
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => {
          const accepted = (row.original as any).accepted;
          const label = accepted ? "Approved" : "Pending";
          const colorClass = accepted ? "text-green-600" : "text-yellow-600";
          return <span className={colorClass}>{label}</span>;
        },
      },
    ];
  }, [entryTypeFilter, entryTypes]);

  if (loading)
    return (
      <div className="flex justify-center py-4">
        <p>Loading your artist data entries...</p>
      </div>
    );
  if (error)
    return (
      <div className="flex justify-center py-4">
        <p className="text-red-500">{error}</p>
      </div>
    );

  const filtered = entries.filter((e) => entryTypeFilter === "All" || e.siteName === entryTypeFilter);

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold text-center">Your Artist Data Entries</h2>
      <UgcEntriesDataTable columns={columns} data={filtered} />
    </div>
  );
} 