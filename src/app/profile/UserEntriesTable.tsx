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

const formatDate = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  return date.toLocaleDateString();
};

const formatTime = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  return date
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\s([AP]M)$/i, "\u00A0$1");
};

export default function UserEntriesTable() {
  const [entries, setEntries] = useState<UserEntry[]>([]);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [filter, setFilter] = useState<string>("all");

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

  const filtered = useMemo(() => {
    if (filter === "all") return entries;
    return entries.filter((e) => e.siteName === filter);
  }, [entries, filter]);

  return (
    <Card className="max-w-3xl mx-auto mt-10">
      <CardHeader className="text-center">
        <CardTitle className="mb-5">Your Artist Data Entries</CardTitle>
        <div className="flex justify-center">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="border border-gray-300 rounded-md p-1 text-sm"
          >
            <option value="all">All</option>
            {Array.from(new Set(entries.map((e) => e.siteName).filter(Boolean))).map((site) => (
              <option key={site as string} value={site as string}>
                {site as string}
              </option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Artist</TableHead>
              <TableHead>Entry Type</TableHead>
              <TableHead>Site Link</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length ? (
              filtered.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{formatDate(entry.createdAt)}</TableCell>
                  <TableCell>{formatTime(entry.createdAt)}</TableCell>
                  <TableCell>{entry.artistName ?? "—"}</TableCell>
                  <TableCell>{entry.siteName ?? "—"}</TableCell>
                  <TableCell>
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
                  <TableCell className="text-green-600 font-semibold">
                    {entry.accepted ? "Approved" : "Pending"}
                  </TableCell>
                </TableRow>
              ))
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