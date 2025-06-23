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
    const dataOptions = availableLinks.map(link => (
        <DropdownMenuItem
            key={link.id}
            className="cursor-pointer"
            onClick={() => setOption(link.example)}
        >
            {link.example}
        </DropdownMenuItem>
    ));
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button className="bg-pastypink text-white h-12 hover:bg-gray-400">
                    Tips
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-48 overflow-auto scrollbar-hide" align="end">
                {dataOptions}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}