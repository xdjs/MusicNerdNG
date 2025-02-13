"use client"

import { ColumnDef } from "@tanstack/react-table";
import { UgcResearch, User } from "@/server/db/DbTypes";
import { ArrowUpDown } from "lucide-react"
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";



export const ugcColumns: ColumnDef<UgcResearch>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "id",
    header: "UGC ID",
  },
  {
    accessorKey: "wallet",
    header: "Wallet Address",
  },
  {
    accessorKey: "name",
    header: "Name",
  },
  {
    accessorKey: "createdAt",
    header: ({ column }) => {
      return (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Created At
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      )
    },
  },
  {
    accessorKey: "updatedAt",
    header: "Updated At",
  },
  {
    accessorKey: "id",
    header: "ID",
  },
  {
    accessorKey: "siteName",
    header: "Site Name",
  },
  {
    accessorKey: "artistUri",
    header: "Artist URI",
  },
  {
    accessorKey: "accepted",
    header: "Accepted",
  },
  {
    accessorKey: "ugcUrl",
    header: "UGC URL",
  },
  {
    accessorKey: "siteUsername",
    header: "Site Username",
  },
  {
    accessorKey: "artistId",
    header: "Artist ID",
  },
  {
    accessorKey: "dateProcessed",
    header: "Date Processed",
  },
  
];

export const whitelistedColumns: ColumnDef<User>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "id",
    header: "ID",
  },
  {
    accessorKey: "wallet",
    header: "Wallet Address",
  },
  {
    accessorKey: "email",
    header: "Email",
  },
  {
    accessorKey: "username",
    header: "Username",
  },
  {
    accessorKey: "updatedAt",
    header: "Updated At",
  }
];
