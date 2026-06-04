"use client"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input"
import { useState, useEffect } from "react";
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
import Link from "next/link";
import { LINK_NOT_SUPPORTED, LINK_TWITTER_INVALID, TIPS_BUTTON_LABEL } from "@/lib/linkSubmissionMessages";

export default function AddArtistData({ artist, spotifyImg, availableLinks, isOpenOnLoad = false, label, directEdit = false }: { artist: Artist, spotifyImg: string, availableLinks: UrlMap[], isOpenOnLoad: boolean, label?: string, directEdit?: boolean }) {
    const { data: session, status } = useSession();
    const [isModalOpen, setIsModalOpen] = useState(isOpenOnLoad);
    const [isLoading, setIsLoading] = useState(false);
    const [addArtistResp, setAddArtistResp] = useState<AddArtistDataResp | null>(null);
    const router = useRouter();
    const { toast } = useToast();

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
            console.debug('Backend validation response:', data);
            return data.valid;
        } catch (e) {
            console.debug('Backend validation error:', e);
            return true; // If the backend fails, don't block the user
        }
    }

    async function onSubmit(values: z.infer<typeof formSchema>) {
        setAddArtistResp(null);
        setIsLoading(true);
        let formattedUrl = values.artistDataUrl.trim();
        if (!/^https?:\/\//i.test(formattedUrl)) {
            formattedUrl = `https://${formattedUrl}`;
        }

        const isTwitterValid = await validateTwitterLink(formattedUrl);
        if (!isTwitterValid) {
            setAddArtistResp({ status: "error", message: LINK_TWITTER_INVALID });
            setIsLoading(false);
            return;
        }
        const isPlatformValid = await validatePlatformLinkBackend(formattedUrl);
        if (!isPlatformValid) {
            setAddArtistResp({ status: "error", message: LINK_NOT_SUPPORTED });
            setIsLoading(false);
            return;
        }
        if (directEdit) {
            try {
                const res = await fetch("/api/directEditLink", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ artistId: artist.id, action: "set", url: formattedUrl }),
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    toast({ title: `${artist.name}'s ${data.platformName ?? data.siteName ?? "link"} saved` });
                    setAddArtistResp({ status: "success", message: "Link saved successfully." });
                } else {
                    setAddArtistResp({ status: "error", message: data.error ?? "Failed to save link." });
                }
            } catch {
                setAddArtistResp({ status: "error", message: "Failed to save link." });
            }
            setIsLoading(false);
            return;
        }
        const resp = await addArtistData(formattedUrl, artist);
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
        }
        setIsModalOpen(isOpen);
        form.reset();
    }

    function checkInput() {
        if (addArtistResp?.status === "success") {
            form.reset();
            setAddArtistResp(null);
        }
    }

    function handleClick() {
        // Session still resolving — don't flash a spurious login prompt at an authed user
        if (status === "loading") return;
        if (!session) {
            // prompt login via nav button — same approach as ClaimButton
            const loginBtn = document.getElementById("login-btn");
            if (loginBtn) loginBtn.click();
            else if (process.env.NODE_ENV !== "production") console.warn("[AddArtistData] #login-btn not found — cannot prompt login");
            return;
        }
        setIsModalOpen(true);
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
                <DialogContent className="sm:max-w-[425px] max-h-screen overflow-auto scrollbar-hide">
                    {spotifyImg && (
                        <AspectRatio ratio={1 / 1} className="bg-muted rounded-md overflow-hidden">
                            <img src={spotifyImg} alt={artist.name ?? "Artist"} className="object-cover w-full h-full" />
                        </AspectRatio>
                    )}
                    <DialogHeader className="space-y-1">
                        <DialogTitle className="text-black dark:text-white text-lg font-bold">
                            {directEdit
                                ? `Add a link for ${artist.name}`
                                : `Suggest a link for ${artist.name}`}
                        </DialogTitle>
                        {!directEdit && (
                            <DialogDescription className="text-xs text-muted-foreground">
                                An admin will review it before it&apos;s added.
                            </DialogDescription>
                        )}
                    </DialogHeader>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
                            <FormField
                                control={form.control}
                                name="artistDataUrl"
                                render={({ field }) => (
                                    <FormItem className="space-y-2">
                                        <div className="flex gap-2">
                                            <FormControl>
                                                <div className="flex-grow glass-subtle rounded-lg flex items-center h-11 px-3">
                                                    <Input
                                                        placeholder="Paste a profile link…"
                                                        onClick={checkInput}
                                                        id="name"
                                                        className="w-full p-0 bg-transparent border-0 outline-none focus:outline-none focus-visible:outline-none focus-visible:!ring-0 focus-visible:!ring-offset-0 text-sm text-black dark:text-white placeholder:text-muted-foreground"
                                                        {...field}
                                                    />
                                                </div>
                                            </FormControl>
                                            <AddArtistDataOptions
                                                availableLinks={displayLinks}
                                                setOption={(option) => {
                                                    // Fill the input with the example so the user can edit it (replace USERNAME, etc.).
                                                    form.setValue("artistDataUrl", option, { shouldDirty: true, shouldValidate: false });
                                                }}
                                            />
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Tap <strong>{TIPS_BUTTON_LABEL}</strong> for the platforms we currently accept.
                                        </p>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <DialogFooter className="flex sm:flex-col gap-2">
                                {addArtistResp && addArtistResp.status === "error" ? (
                                    <Label className="text-xs text-red-600 dark:text-red-400 leading-relaxed">
                                        {addArtistResp.message}
                                    </Label>
                                ) : null}
                                <Button type="submit" className="bg-pastypink hover:bg-pastypink/90 text-white">
                                    {isLoading ? (
                                        <img className="max-h-6" src="/spinner.svg" alt="submitting" />
                                    ) : (
                                        <span>{directEdit ? "Save Link" : "Submit"}</span>
                                    )}
                                </Button>
                                {addArtistResp && addArtistResp.status === "success" ? (
                                    <div className="flex flex-col items-center gap-1">
                                        <h2 className="text-sm font-semibold text-green-600 dark:text-green-400">
                                            {addArtistResp.message}
                                        </h2>
                                        <Link href="/leaderboard" className="text-xs text-pastypink hover:underline">
                                            View Leaderboard
                                        </Link>
                                    </div>
                                ) : null}
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>
        </>
    )
}
