"use client"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UrlMap } from "@/server/db/DbTypes";
import { TIPS_BUTTON_LABEL } from "@/lib/linkSubmissionMessages";

/**
 * Wallet/ENS examples in the urlmap aren't actually link-paste targets — exclude them from the picker.
 * Anchored on word boundaries + a 6-char minimum so a hypothetical platform whose example
 * coincidentally contains "0x" (e.g. "0xtracks.com/...") isn't false-positive-filtered.
 */
export function isWalletExample(example: string | null | undefined): boolean {
    if (!example) return false;
    return /\b0x[0-9a-f]{6,}\b/i.test(example);
}

export default function AddArtistDataOptions({ availableLinks, setOption }: { availableLinks: UrlMap[], setOption: (option: string) => void }) {
    const sortedLinks = [...availableLinks]
        .filter(link => !isWalletExample(link.example))
        .sort((a, b) => (a.example || "").localeCompare(b.example || ""));
    const dataOptions = sortedLinks.map(link => (
        <DropdownMenuItem
            key={link.id}
            className="cursor-pointer text-xs text-black dark:text-white focus:bg-pastypink/15 focus:text-pastypink"
            onClick={() => setOption(link.example.replace(/^(?:https?:\/\/)?(?:www\.)?/, ''))}
        >
            {link.example.replace(/^(?:https?:\/\/)?(?:www\.)?/, '')}
        </DropdownMenuItem>
    ));
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 text-black dark:text-white whitespace-nowrap"
                >
                    {TIPS_BUTTON_LABEL}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                side="top"
                align="end"
                sideOffset={6}
                className="glass-subtle scrollbar-glass max-h-44 overflow-auto p-1 border-0 shadow-lg"
            >
                {dataOptions}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
