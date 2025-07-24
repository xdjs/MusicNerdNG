import { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export type UgcEntryRow = {
  id: string;
  artistId: string | null;
  artistName: string | null;
  siteName: string | null;
  ugcUrl: string | null;
  createdAt: string | null;
  accepted: boolean | null;
  dateProcessed: string | null;
  imageUrl: string | null;
};

// Helper to format dates (local timezone)
const formatDate = (value: string | Date | null | undefined): string => {
  if (!value) return "";
  const dateObj = value instanceof Date ? value : new Date(value);
  const datePart = dateObj.toLocaleDateString();
  const timePart = dateObj.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).replace(/\s([AP]M)$/i, "\u00A0$1");
  return `${datePart} ${timePart}`;
};

export const ugcEntryColumns: ColumnDef<UgcEntryRow>[] = [
  // Date Added first
  {
    accessorKey: "createdAt",
    header: ({ column }) => (
      <Button
        variant="ghost"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
      >
        Date Added
        <ArrowUpDown className="ml-2 h-4 w-4" />
      </Button>
    ),
    cell: ({ getValue }) => formatDate(getValue() as string | Date | null | undefined),
  },
  // Artist column (duplicates will be pre-processed to blank)
  {
    accessorKey: "artistName",
    header: "Artist",
    cell: ({ getValue }) => {
      const name = getValue() as string | null;
      return name ?? "";
    },
  },
  {
    accessorKey: "siteName",
    header: "Entry Type",
  },
  {
    accessorKey: "ugcUrl",
    header: "Site Link",
    cell: ({ getValue }) => {
      const url = getValue() as string | null;
      return url ? (
        <Link href={url} target="_blank" rel="noopener noreferrer" className="underline text-blue-600 hover:text-blue-800">
          View
        </Link>
      ) : (
        "—"
      );
    },
  },
  {
    id: "status",
    header: "Status",
    accessorFn: (row) => (row.accepted ? "Approved" : "Pending"),
  },
]; 