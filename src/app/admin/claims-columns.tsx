"use client"

import { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

export interface ClaimRow {
    id: string;
    status: "pending" | "approved" | "rejected";
    referenceCode: string | null;
    artistName: string;
    artistId: string;
    artistInstagram: string | null;
    userEmail: string | null;
    userName: string | null;
    createdAt: string;
}

const formatDate = (value: string | null | undefined): string => {
    if (!value) return "";
    const hasExplicitTZ = /Z$|[+-]\d{2}:?\d{2}$/.test(value);
    const dateObj = new Date(hasExplicitTZ ? value : `${value}Z`);
    const datePart = dateObj.toLocaleDateString();
    const timePart = dateObj
        .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true })
        .replace(/\s([AP]M)$/i, "\u00A0$1");
    return `${datePart} ${timePart}`;
};

const statusColors: Record<string, string> = {
    pending: "bg-amber-500/15 text-amber-500",
    approved: "bg-green-500/15 text-green-500",
    rejected: "bg-red-500/15 text-red-500",
};

export const claimsColumns: ColumnDef<ClaimRow>[] = [
    {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusColors[row.original.status] ?? ""}`}>
                {row.original.status}
            </span>
        ),
    },
    {
        accessorKey: "referenceCode",
        header: "Ref Code",
        cell: ({ row }) => (
            <span className="font-mono font-bold text-sm">
                {row.original.referenceCode ?? "—"}
            </span>
        ),
    },
    {
        accessorKey: "artistName",
        header: "Artist",
        cell: ({ row }) => (
            <Link
                href={`/artist/${row.original.artistId}`}
                className="text-pastypink hover:underline text-sm"
            >
                {row.original.artistName}
            </Link>
        ),
    },
    {
        accessorKey: "artistInstagram",
        header: "Artist IG",
        cell: ({ row }) => {
            const ig = row.original.artistInstagram;
            if (!ig) return <span className="text-muted-foreground text-xs">Not set</span>;
            return (
                <a
                    href={`https://instagram.com/${ig}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-pastypink hover:underline text-sm"
                >
                    @{ig}
                </a>
            );
        },
    },
    {
        accessorKey: "userEmail",
        header: "User",
        cell: ({ row }) => (
            <span className="text-sm">
                {row.original.userName || row.original.userEmail || "Unknown"}
            </span>
        ),
    },
    {
        accessorKey: "createdAt",
        header: "Submitted",
        cell: ({ row }) => (
            <span className="text-sm">{formatDate(row.original.createdAt)}</span>
        ),
    },
];
