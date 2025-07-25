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
import { Input } from "@/components/ui/input";
import { Search as SearchIcon } from "lucide-react";
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
  const [filter, setFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [artistQuery, setArtistQuery] = useState("");
  const [statusSort, setStatusSort] = useState<"default" | "approved" | "pending">("default");

  useEffect(() => {
    async function fetchEntries() {
      try {
        const res = await fetch(`/api/userEntries?all=true`);
        if (!res.ok) return;
        const data: ApiResponse = await res.json();
        setEntries(data.entries);
      } catch (e) {
        console.error("[UserEntriesTable] failed to fetch entries", e);
      }
    }
    fetchEntries();
  }, []);

  const processed = useMemo(() => {
    let arr = [...entries];
    // filter by entry type
    if (filter !== "all") arr = arr.filter((e) => e.siteName === filter);
    // filter by artist query
    if (artistQuery.trim()) {
      const q = artistQuery.toLowerCase();
      arr = arr.filter((e) => (e.artistName ?? "").toLowerCase().includes(q));
    }
    // sort by full timestamp (most recent first / oldest depending on sortOrder)
    arr.sort((a, b) => {
      const tA = parseUTC(a.createdAt ?? "").getTime();
      const tB = parseUTC(b.createdAt ?? "").getTime();
      return sortOrder === "asc" ? tA - tB : tB - tA;
    });

    if (statusSort !== "default") {
      arr.sort((a, b) => {
        const aApproved = !!a.accepted;
        const bApproved = !!b.accepted;
        if (statusSort === "approved") {
          // approved first
          return aApproved === bApproved ? 0 : aApproved ? -1 : 1;
        } else {
          // pending first
          return aApproved === bApproved ? 0 : aApproved ? 1 : -1;
        }
      });
    }
    return arr;
  }, [entries, filter, sortOrder, artistQuery, statusSort]);

  return (
    <Card className="max-w-3xl mx-auto mt-10">
      <CardHeader className="text-center pb-2">
        <CardTitle className="mb-2">Your Artist Data Entries</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                className="text-center cursor-pointer select-none py-2 px-3"
                onClick={() => setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"))}
              >
                <div className="flex items-center justify-center gap-1">
                  <span>Date</span>
                  <ArrowUpDown
                    className={`w-3 h-3 transition-transform ${sortOrder === "desc" ? "rotate-180" : ""}`}
                  />
                </div>
              </TableHead>
              <TableHead className="text-center py-2 px-3">Time</TableHead>
              <TableHead className="text-center py-2 px-3">
                <div className="flex items-center justify-center gap-2">
                  <span>Artist</span>
                  <div className="relative flex items-center">
                    <Input
                      value={artistQuery}
                      onChange={(e) => setArtistQuery(e.target.value)}
                      placeholder="Search"
                      className="h-6 pr-6 pl-2 py-1 text-xs w-24 bg-white border border-gray-300"
                    />
                    <SearchIcon className="absolute right-1.5 h-3.5 w-3.5 text-gray-500" strokeWidth={2} />
                  </div>
                </div>
              </TableHead>
              <TableHead className="text-center py-2 px-3">
                <div className="flex items-center justify-center gap-2">
                  <span className="whitespace-nowrap">Entry Type</span>
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
              <TableHead className="text-center py-2 px-3 whitespace-nowrap">Site Link</TableHead>
              <TableHead className="text-center py-2 px-3">
                <div className="flex items-center justify-center gap-2">
                  <span>Status</span>
                  <select
                    value={statusSort}
                    onChange={(e) => setStatusSort(e.target.value as any)}
                    className="border border-gray-300 rounded-md p-1 text-xs bg-white"
                  >
                    <option value="default">Recent</option>
                    <option value="approved">Approved First</option>
                    <option value="pending">Pending First</option>
                  </select>
                </div>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {processed.length ? (
              (() => {
                let lastArtist: string | null = null;
                const pageStart = (page - 1) * PER_PAGE;
                const pageEnd = pageStart + PER_PAGE;
                return processed.slice(pageStart, pageEnd).map((entry) => {
                  const displayArtist = entry.artistName ?? lastArtist ?? "—";
                  if (entry.artistName) lastArtist = entry.artistName;
                  return (
                    <TableRow key={entry.id} className="bg-gray-50 hover:bg-gray-50">
                      <TableCell className="text-center px-3 py-2">{formatDate(entry.createdAt)}</TableCell>
                      <TableCell className="text-center px-3 py-2">{formatTime(entry.createdAt)}</TableCell>
                      <TableCell className="text-center px-3 py-2">{displayArtist}</TableCell>
                      <TableCell className="text-center px-3 py-2">{entry.siteName ?? "—"}</TableCell>
                      <TableCell className="text-center px-3 py-2">
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
                      <TableCell className="text-center px-3 py-2 text-green-600 font-semibold">
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
      {processed.length > PER_PAGE && (
        <div className="flex justify-end items-center gap-4 p-6 pt-0">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Prev
          </Button>
          <span className="text-sm">Page {page} of {Math.ceil(processed.length / PER_PAGE)}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= Math.ceil(processed.length / PER_PAGE)}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </Card>
  );
} 