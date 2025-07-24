import { ColumnDef } from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

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

export function createUgcEntryColumns(
  entryTypes: string[],
  filter: string,
  onFilterChange: (val: string) => void
): ColumnDef<UgcEntryRow>[] {
  return [
    {
      accessorKey: "createdAt",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          className="px-0"
        >
          Date
          <ArrowUpDown className="ml-1 h-4 w-4" />
        </Button>
      ),
      cell: ({ getValue }) => {
        const val = getValue() as string | Date | null | undefined;
        if (!val) return "";
        const dateObj = val instanceof Date ? val : new Date(val);
        return dateObj.toLocaleDateString();
      },
    },
    {
      id: "time",
      header: "Time",
      accessorFn: (row) => row.createdAt,
      cell: ({ getValue }) => {
        const val = getValue() as string | Date | null | undefined;
        if (!val) return "";
        const dateObj = val instanceof Date ? val : new Date(val);
        return dateObj.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });
      },
    },
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
      header: () => (
        <div className="flex items-center gap-2">
          <span>Entry Type</span>
          <Select value={filter} onValueChange={onFilterChange}>
            <SelectTrigger className="w-28 h-7 text-xs">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All</SelectItem>
              {entryTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ),
    },
    {
      accessorKey: "ugcUrl",
      header: "Site Link",
      cell: ({ getValue }) => {
        const url = getValue() as string | null;
        return url ? (
          <Link
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline text-blue-600 hover:text-blue-800"
          >
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
} 