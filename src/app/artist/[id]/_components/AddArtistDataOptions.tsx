"use client"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UrlMap } from "@/server/db/DbTypes";

export default function AddArtistDataOptions({availableLinks, setOption}: {availableLinks: UrlMap[], setOption: (option: string) => void}) {
    const sortedLinks = [...availableLinks].sort((a, b) => (a.example || "").localeCompare(b.example || ""));

    const HIGHLIGHT_TARGET = "USERNAME";

    const renderExample = (example: string) => {
        const noProtocol = example.replace(/^https?:\/\//, "");
        if (!noProtocol.includes(HIGHLIGHT_TARGET)) return noProtocol;

        const [prefix, suffix] = noProtocol.split(HIGHLIGHT_TARGET);
        return (
            <>
                {prefix}
                <span className="px-1 bg-yellow-200 text-black rounded-sm">{HIGHLIGHT_TARGET}</span>
                {suffix}
            </>
        );
    };

    const dataOptions = sortedLinks.map(link => (
        <DropdownMenuItem
            key={link.id}
            className="cursor-pointer"
            onClick={() => setOption(link.example)}
        >
            {renderExample(link.example)}
        </DropdownMenuItem>
    ));
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button className="bg-pastypink text-white h-12 hover:bg-gray-400">
                    Tips
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-48 overflow-auto" align="end">
                {dataOptions}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}