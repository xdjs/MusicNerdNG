"use client"

import { ColumnDef } from "@tanstack/react-table";
import { UgcResearch } from "@/server/db/DbTypes";
import { ArrowUpDown } from "lucide-react"
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { MoreHorizontal } from "lucide-react"


export const columns: ColumnDef<UgcResearch>[] = [
  {
    id: "actions",
    cell: ({ row }) => {
      const ugc = row.original
 
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <span className="sr-only">Open menu</span>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem >
              <Button variant="ghost" className="p-0 h-5">Delete UGC</Button>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Button variant="ghost" className="p-0 h-5">Approve UGC</Button>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
  },
  {
    accessorKey: "id",
    header: "UGC ID",
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
