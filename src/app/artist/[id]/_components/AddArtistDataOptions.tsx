"use client"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UrlMap } from "@/server/db/DbTypes";

export default function AddArtistDataOptions({availableLinks, setOption}: {availableLinks: UrlMap[], setOption: (option: string) => void}) {

    const dataOptions = availableLinks.map(link => <DropdownMenuItem className="cursor-pointer" onClick={() => setOption(link.example.split(" ")[0])}>{link.example.split(" ")[0]}</DropdownMenuItem>);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline">
                    Options
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-48 overflow-auto scrollbar-hide" align="end">
                <DropdownMenuLabel>Data source options</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {dataOptions}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}