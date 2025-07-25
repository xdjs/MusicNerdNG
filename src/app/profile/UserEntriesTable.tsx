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
  const [filter, setFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [timeSort, setTimeSort] = useState<"asc" | "desc">("desc");
  const [artistQuery, setArtistQuery] = useState("");

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
    // sort by date, then time within same date
    arr.sort((a, b) => {
      const dA = parseUTC(a.createdAt ?? "");
      const dB = parseUTC(b.createdAt ?? "");
      // compare date (year,month,day)
      const dateOnlyA = new Date(dA.getFullYear(), dA.getMonth(), dA.getDate()).getTime();
      const dateOnlyB = new Date(dB.getFullYear(), dB.getMonth(), dB.getDate()).getTime();

      if (dateOnlyA !== dateOnlyB) {
        return sortOrder === "asc" ? dateOnlyA - dateOnlyB : dateOnlyB - dateOnlyA;
      }
      // same date – compare time
      return timeSort === "asc" ? dA.getTime() - dB.getTime() : dB.getTime() - dA.getTime();
    });
    return arr;
  }, [entries, filter, sortOrder, timeSort, artistQuery]);

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
              <TableHead
                className="text-center cursor-pointer select-none py-2 px-3"
                onClick={() => setTimeSort((prev) => (prev === "desc" ? "asc" : "desc"))}
              >
                <div className="flex items-center justify-center gap-1">
                  <span>Time</span>
                  <ArrowUpDown
                    className={`w-3 h-3 transition-transform ${timeSort === "desc" ? "rotate-180" : ""}`}
                  />
                </div>
              </TableHead>
              <TableHead className="text-center py-2 px-3">
                <div className="flex items-center justify-center gap-2">
                  <span>Artist</span>
                  <Input
                    value={artistQuery}
                    onChange={(e) => setArtistQuery(e.target.value)}
                    placeholder="Search"
                    className="h-6 px-2 py-1 text-xs w-24 bg-white border border-gray-300"
                  />
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
              <TableHead className="text-center py-2 px-3">Status</TableHead>
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
      {/* Pagination removed as all entries loaded */}
    </Card>
  );
} 