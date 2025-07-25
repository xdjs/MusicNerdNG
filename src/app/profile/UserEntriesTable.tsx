"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ArrowUpDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

interface UserEntry {
  id: string;
  createdAt: string | null;
  artistName: string | null;
  siteName: string | null;
  ugcUrl: string | null;
  accepted: boolean | null;
}

type ApiResponse = {
  entries: UserEntry[];
  total: number;
  pageCount: number;
};

const PER_PAGE = 10;

const parseUTC = (s: string): Date => {
  // If string already has timezone info (Z or +/-), keep as is; else assume UTC by appending Z
  return new Date(/Z|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);
};

const formatDate = (iso: string | null) => {
  if (!iso) return "";
  const date = parseUTC(iso);
  return date.toLocaleDateString();
};

const formatTime = (iso: string | null) => {
  if (!iso) return "";
  const date = parseUTC(iso);
  return date
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\s([AP]M)$/i, "\u00A0$1");
};

export default function UserEntriesTable() {
  const [entries, setEntries] = useState<UserEntry[]>([]);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [filter, setFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    async function fetchEntries() {
      try {
        const res = await fetch(`/api/userEntries?page=${page}`);
        if (!res.ok) return;
        const data: ApiResponse = await res.json();
        setEntries(data.entries);
        setPageCount(data.pageCount);
      } catch (e) {
        console.error("[UserEntriesTable] failed to fetch entries", e);
      }
    }
    fetchEntries();
  }, [page]);

  const processed = useMemo(() => {
    let arr = [...entries];
    // filter
    if (filter !== "all") arr = arr.filter((e) => e.siteName === filter);
    // sort by date
    arr.sort((a, b) => {
      const tA = new Date(a.createdAt ?? "").getTime();
      const tB = new Date(b.createdAt ?? "").getTime();
      return sortOrder === "asc" ? tA - tB : tB - tA;
    });
    return arr;
  }, [entries, filter, sortOrder]);

  return (
    <Card className="max-w-3xl mx-auto mt-10">
      <CardHeader className="text-center">
        <CardTitle className="mb-5">Your Artist Data Entries</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                className="text-center cursor-pointer select-none"
                onClick={() => setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"))}
              >
                <div className="flex items-center justify-center gap-1">
                  <span>Date</span>
                  <ArrowUpDown
                    className={`w-3 h-3 transition-transform ${sortOrder === "desc" ? "rotate-180" : ""}`}
                  />
                </div>
              </TableHead>
              <TableHead className="text-center">Time</TableHead>
              <TableHead className="text-center">Artist</TableHead>
              <TableHead className="text-center">
                <div className="flex items-center justify-center gap-2">
                  <span>Entry Type</span>
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="border border-gray-300 rounded-md p-1 text-xs"
                  >
                    <option value="all">All</option>
                    {Array.from(new Set(entries.map((e) => e.siteName).filter(Boolean))).map((site) => (
                      <option key={site as string} value={site as string}>
                        {site as string}
                      </option>
                    ))}
                  </select>
                </div>
              </TableHead>
              <TableHead className="text-center">Site Link</TableHead>
              <TableHead className="text-center">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {processed.length ? (
              (() => {
                let lastArtist: string | null = null;
                return processed.map((entry) => {
                  const displayArtist = entry.artistName ?? lastArtist ?? "—";
                  if (entry.artistName) lastArtist = entry.artistName;
                  return (
                    <TableRow key={entry.id}>
                      <TableCell className="text-center px-2">{formatDate(entry.createdAt)}</TableCell>
                      <TableCell className="text-center px-2">{formatTime(entry.createdAt)}</TableCell>
                      <TableCell className="text-center px-2">{displayArtist}</TableCell>
                      <TableCell className="text-center px-2">{entry.siteName ?? "—"}</TableCell>
                      <TableCell className="text-center px-2">
                        {entry.ugcUrl ? (
                          <Link
                            className="text-blue-600 underline"
                            href={entry.ugcUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            View
                          </Link>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-center px-2 text-green-600 font-semibold">
                        {entry.accepted ? "Approved" : "Pending"}
                      </TableCell>
                    </TableRow>
                  );
                });
              })()
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-4">
                  No entries
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </div>
      </CardContent>
      {pageCount > 1 && (
        <div className="flex justify-end items-center gap-4 p-6 pt-0">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Prev
          </Button>
          <span className="text-sm">
            Page {page} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page === pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </Card>
  );
} 