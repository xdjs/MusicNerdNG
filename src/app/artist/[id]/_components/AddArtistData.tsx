"use client"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input"
import { useState, useEffect, useRef } from "react";
import { Artist } from "@/server/db/DbTypes";
import { AspectRatio } from "@radix-ui/react-aspect-ratio";
import { Label } from "@radix-ui/react-label";
import { useSession } from "next-auth/react";
import { UrlMap } from "@/server/db/DbTypes";
import AddArtistDataOptions from "./AddArtistDataOptions";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormMessage,
} from "@/components/ui/form";
import { addArtistDataAction as addArtistData, type AddArtistDataResp } from "@/app/actions/serverActions";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { Plus } from "lucide-react";
import { useConnectModal } from '@rainbow-me/rainbowkit';

export default function AddArtistData({ artist, spotifyImg, availableLinks, isOpenOnLoad = false, label }: { artist: Artist, spotifyImg: string, availableLinks: UrlMap[], isOpenOnLoad: boolean, label?: string }) {
    const { data: session } = useSession();
    const [isModalOpen, setIsModalOpen] = useState(isOpenOnLoad);
    const [selectedOption, setSelectedOption] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    // Ref for the text input so we can programmatically select the USERNAME portion
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [addArtistResp, setAddArtistResp] = useState<AddArtistDataResp | null>(null);
    const router = useRouter();
    const { toast } = useToast();
    const isWalletRequired = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT !== 'true';
    
    // Always call hooks, conditionally use their results
    const { openConnectModal } = useConnectModal();

    // State to hold platform regexes from the backend
    const [platformRegexes, setPlatformRegexes] = useState<{ siteName: string, regex: string }[]>([]);

    // Fetch regexes from the backend on mount
    useEffect(() => {
        fetch('/api/platformRegexes')
            .then(res => res.json())
            .then(data => setPlatformRegexes(data))
            .catch(e => console.error('Failed to fetch platform regexes:', e));
    }, []);

    const formSchema = useMemo(() => z.object({
        artistDataUrl: z.string()
    }), [availableLinks])

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        mode: "onSubmit",
        defaultValues: {
            artistDataUrl: "",
        },
    })

    // Filter out ENS and wallets from display, but keep them in availableLinks for add options
    const displayLinks = availableLinks.filter(link => link.siteName !== 'ens' && link.siteName !== 'wallets');

    // When the user chooses a template (e.g. https://instagram.com/USERNAME) we want to:
    // 1. Prefill the form input with the full example.
    // 2. Automatically highlight the USERNAME section so the user can immediately type.
    useEffect(() => {
        if (!selectedOption) return;

        // Always set the value first so we have the correct text in the field
        form.setValue("artistDataUrl", selectedOption, { shouldDirty: true, shouldTouch: true });

        // Focus the input and select the USERNAME part (if it exists)
        const current = inputRef.current;
        if (!current) return;

        // Defer selection until after the DOM updates
        setTimeout(() => {
            current.focus();

            // Detect the first placeholder token (all caps, underscores allowed) like USERNAME, ARTIST_NAME, CHANNEL_ID
            const placeholderMatch = selectedOption.match(/[A-Z][A-Z0-9_]+/);

            if (placeholderMatch) {
                const placeholderText = placeholderMatch[0];
                const startIdx = selectedOption.indexOf(placeholderText);
                current.setSelectionRange(startIdx, startIdx + placeholderText.length);
            } else {
                // If no placeholder present, place caret at end
                const len = selectedOption.length;
                current.setSelectionRange(len, len);
            }
        }, 0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedOption]);

    async function validateTwitterLink(url: string): Promise<boolean> {
        try {
            const twitterRegex = /^https?:\/\/(www\.)?(twitter|x)\.com\/[A-Za-z0-9_]{1,15}$/;
            if (!twitterRegex.test(url)) return true; // Not a Twitter/X link, skip validation

            const response = await fetch(url, { method: "GET" });
            // Only fail if status is 404 (profile does not exist)
            if (response.status === 404) return false;
            return true; // Any other status (including redirects, 403, 429, etc.) is considered valid
        } catch (e) {
            return true; // Network/CORS errors are considered valid
        }
    }

    // Add a function to call the backend validator
    async function validatePlatformLinkBackend(url: string): Promise<boolean> {
        // Determine which platform regex matches this URL
        let matchedPlatform: string | null = null;
        for (const { siteName, regex } of platformRegexes) {
            try {
                if (new RegExp(regex.trim()).test(url)) {
                    matchedPlatform = siteName;
                    break;
                }
            } catch (e) {
                console.debug(`[${siteName}] Regex error:`, e);
            }
        }

        if (!matchedPlatform) {
            console.debug('No platform regex matched for URL:', url);
            return false; // Reject invalid URLs
        }

        // Platforms that have backend validation implemented
        const backendPlatforms = [
            'youtube',
            'soundcloud',
            'bandcamp',
            'audius',
            'lastfm',
            'opensea',
            'zora',
            'catalog',
            'supercollector',
            'mintsongs'
        ];

        // If the matched platform is not backend-validated, accept it based on regex
        if (!backendPlatforms.includes(matchedPlatform)) {
            return true;
        }

        try {
            const response = await fetch('/api/validateLink', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url }),
            });
            const data = await response.json();
            console.debug('Backend validation response:', data); // Frontend log
            return data.valid;
        } catch (e) {
            console.debug('Backend validation error:', e); // Frontend log
            return true; // If the backend fails, don't block the user
        }
    }

    async function onSubmit(values: z.infer<typeof formSchema>) {
        setAddArtistResp(null);
        setIsLoading(true);
        const isTwitterValid = await validateTwitterLink(values.artistDataUrl);
        if (!isTwitterValid) {
            setAddArtistResp({ status: "error", message: "This link is invalid. Please enter a valid Twitter/X profile URL." });
            setIsLoading(false);
            return;
        }
        // Only use regex and backend for YouTube validation
        const isPlatformValid = await validatePlatformLinkBackend(values.artistDataUrl);
        if (!isPlatformValid) {
            setAddArtistResp({ status: "error", message: "This link is invalid or not supported." });
            setIsLoading(false);
            return;
        }
        const resp = await addArtistData(values.artistDataUrl, artist);
        if (resp.status === "success") {
            toast({
                title: `${artist.name}'s ${resp.siteName ?? "data"} added`,
            })
        }
        setAddArtistResp(resp);
        setIsLoading(false);
    }

    function handleClose(isOpen: boolean) {
        if (!isOpen && addArtistResp && addArtistResp.status === "success") {
            router.refresh();
        }
        if (!isOpen) {
            setAddArtistResp(null);
            setSelectedOption("");
        }
        setIsModalOpen(isOpen);
        form.reset();
    }

    // Regex that matches placeholder tokens like USERNAME, ARTIST_NAME, CHANNEL_ID
    const PLACEHOLDER_REGEX_GLOBAL = /[A-Z][A-Z0-9_]+/g;

    function checkInput() {
        // Clear any success message when user edits again
        if (addArtistResp?.status === "success") {
            form.reset();
            setAddArtistResp(null);
        }

        const currentVal = form.getValues("artistDataUrl");
        // Find first placeholder position so we know where to place the caret later
        const firstPlaceholderMatch = currentVal.match(PLACEHOLDER_REGEX_GLOBAL);
        const firstPlaceholder = firstPlaceholderMatch ? firstPlaceholderMatch[0] : null;
        const startIdx = firstPlaceholder ? currentVal.indexOf(firstPlaceholder) : -1;

        let sanitized = currentVal.replace(PLACEHOLDER_REGEX_GLOBAL, "");

        // Basic cleanup: remove any "://." pattern left by subdomain placeholders and collapse consecutive dots
        sanitized = sanitized.replace(/:\/\//, "://").replace(/:\/\//g, "://").replace(/\.\./g, ".").replace(/:\/\//g, "://");
 
        if (sanitized !== currentVal) {
            form.setValue("artistDataUrl", sanitized, { shouldDirty: true, shouldTouch: true });
 
            // Move cursor to the end after stripping
            setTimeout(() => {
                const el = inputRef.current;
                if (el) {
                    if (startIdx !== -1) {
                        el.setSelectionRange(startIdx, startIdx);
                    } else {
                        const len = sanitized.length;
                        el.setSelectionRange(len, len);
                    }
                }
            }, 0);
        }
    }

    function handleClick() {
        if (!isWalletRequired || session) {
            setIsModalOpen(true);
        } else if (openConnectModal) {
            openConnectModal();
        }
    }

    return (
        <>
            <Button
                size={label ? "sm" : "icon"}
                className={label
                    ? "text-white bg-pastypink flex items-center justify-center px-4 min-w-[60px]"
                    : "text-white bg-pastypink rounded-lg hover:bg-pastypink/90 w-8 h-8 p-0 flex items-center justify-center"}
                onClick={handleClick}
            >
                {label ? <span className="whitespace-nowrap">{label}</span> : <Plus color="white" size={24} />}
            </Button>
            <Dialog open={isModalOpen} onOpenChange={handleClose}>
                <DialogContent className="sm:max-w-[425px] max-h-screen overflow-auto scrollbar-hide text-black">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            <div>
                                <AspectRatio ratio={1 / 1} className="flex items-center place-content-center bg-muted rounded-md overflow-hidden w-full">
                                    {(spotifyImg) &&
                                        <img src={spotifyImg} alt="Artist Image" className="object-cover" />
                                    }
                                </AspectRatio>
                            </div>
                            <DialogHeader>
                                <DialogTitle>
                                    <p>
                                        Add a place where {artist.name} can be found
                                    </p>
                                </DialogTitle>
                            </DialogHeader>
                            <div className="grid gap-4 text-black">
                                <FormField
                                    control={form.control}
                                    name="artistDataUrl"
                                    render={({ field }) => (
                                        <FormItem>
                                            <div className="flex gap-4">
                                                <FormControl>
                                                    <div className="flex-grow px-3 py-0 bg-gray-100 rounded-lg flex items-center gap-2 h-12 hover:bg-gray-200 transition-colors duration-300">
                                                        <Input
                                                            {...field}
                                                            // Attach the combined ref so react-hook-form and our logic both get it
                                                            ref={(el) => {
                                                                field.ref(el);
                                                                inputRef.current = el;
                                                            }}
                                                            placeholder={selectedOption}
                                                            onClick={checkInput}
                                                            onFocus={checkInput}
                                                            id="artistDataUrl-input"
                                                            className="w-full p-0 bg-transparent focus:outline-none text-md"
                                                        />
                                                    </div>
                                                </FormControl>
                                                <AddArtistDataOptions availableLinks={displayLinks} setOption={(option) => setSelectedOption(option)} />
                                            </div>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                            <p>
                                Once you submit the link we&apos;ll look it over to make sure it all checks out!
                            </p>
                            <DialogFooter className="flex sm:flex-col gap-4">
                                {addArtistResp && addArtistResp.status === "error" ?
                                    <Label className="text-red-600">{addArtistResp.message}</Label> : null
                                }
                                <Button type="submit" className="bg-pastyblue hover:bg-gray-400 text-white">
                                    {isLoading ?
                                        <img className="max-h-6" src="/spinner.svg" alt="whyyyyy" />
                                        : <span>Add Artist Data</span>
                                    }
                                </Button>
                                {addArtistResp && addArtistResp.status === "success" ?
                                    <h2 className="text-green-600">{addArtistResp.message}</h2>
                                    : null
                                }
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>
        </>
    )
}
