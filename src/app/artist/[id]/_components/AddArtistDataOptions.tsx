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

    // Highlight any placeholder token that appears to be all uppercase letters (possibly including underscores/numbers),
    // e.g., USERNAME, ARTIST_NAME, CHANNEL_ID.
    const PLACEHOLDER_REGEX = /[A-Z][A-Z0-9_]+/g;

    const renderExample = (example: string) => {
        const noProtocol = example.replace(/^https?:\/\//, "");

        // If no placeholder match, just return the stripped URL
        if (!PLACEHOLDER_REGEX.test(noProtocol)) return noProtocol;

        // Split string while keeping the delimiters (placeholders) by using regex capture groups in split
        const parts = noProtocol.split(PLACEHOLDER_REGEX);
        // We also need the matched placeholders themselves to interleave
        const matches = noProtocol.match(PLACEHOLDER_REGEX) ?? [];

        // Interleave parts and matches
        const children: React.ReactNode[] = [];
        parts.forEach((part, idx) => {
            if (part) children.push(part);
            if (matches[idx]) {
                children.push(
                    <span key={`ph-${idx}`} className="px-1 bg-yellow-200 text-black rounded-sm whitespace-nowrap">
                        {matches[idx]}
                    </span>
                );
            }
        });

        return <>{children}</>;
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