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
import Link from "next/link";
import { LINK_NOT_SUPPORTED, LINK_TWITTER_INVALID, TIPS_BUTTON_LABEL } from "@/lib/linkSubmissionMessages";

type AddArtistDataProps = {
    artist: Artist;
    spotifyImg: string;
    availableLinks: UrlMap[];
    isOpenOnLoad: boolean;
    prefillUrl?: string;
    label?: string;
    directEdit?: boolean;
    autoApprove?: boolean;
};

type PlatformRegexStatus = "loading" | "ready" | "error";

function promptLogin() {
    const loginBtn = document.getElementById("login-btn");
    if (loginBtn) {
        loginBtn.click();
        return true;
    }

    if (process.env.NODE_ENV !== "production") {
        console.warn("[AddArtistData] #login-btn not found — cannot prompt login");
    }
    return false;
}

export default function AddArtistData({ artist, spotifyImg, availableLinks, isOpenOnLoad = false, prefillUrl, label, directEdit = false, autoApprove = false }: AddArtistDataProps) {
    const { data: session, status } = useSession();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [addArtistResp, setAddArtistResp] = useState<AddArtistDataResp | null>(null);
    const handledAddLinkRef = useRef<string | null>(null);
    const loginPromptedForAddLinkRef = useRef<string | null>(null);
    const router = useRouter();
    const { toast } = useToast();

    // State to hold platform regexes from the backend
    const [platformRegexes, setPlatformRegexes] = useState<{ siteName: string, regex: string }[]>([]);
    const [platformRegexStatus, setPlatformRegexStatus] = useState<PlatformRegexStatus>("loading");

    // Fetch regexes from the backend on mount
    useEffect(() => {
        let isMounted = true;

        fetch('/api/platformRegexes')
            .then(res => {
                if (!res.ok) throw new Error(`Platform regex request failed with ${res.status}`);
                return res.json();
            })
            .then(data => {
                if (!Array.isArray(data)) throw new Error('Platform regex response was not an array');
                if (!isMounted) return;
                setPlatformRegexes(data);
                setPlatformRegexStatus("ready");
            })
            .catch(e => {
                console.error('Failed to fetch platform regexes:', e);
                if (isMounted) setPlatformRegexStatus("error");
            });

        return () => {
            isMounted = false;
        };
    }, []);

    const formSchema = useMemo(() => z.object({
        artistDataUrl: z.string()
    }), [availableLinks])

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        mode: "onSubmit",
        defaultValues: {
            artistDataUrl: prefillUrl ?? "",
        },
    })

    const { reset } = form;

    // addLink is a one-shot handoff from search. It uses the same authentication
    // gate as a manual open. Keep the URL intact while login is pending because
    // Privy reloads the page after creating the NextAuth session; the authenticated
    // mount can then open the dialog and consume the handoff without submitting it.
    useEffect(() => {
        if (!isOpenOnLoad || !prefillUrl) {
            handledAddLinkRef.current = null;
            loginPromptedForAddLinkRef.current = null;
            return;
        }

        const addLinkKey = `${artist.id}:${prefillUrl}`;
        if (handledAddLinkRef.current === addLinkKey) return;
        if (status === "loading") return;

        if (!session) {
            setIsModalOpen(false);
            if (
                loginPromptedForAddLinkRef.current !== addLinkKey
                && promptLogin()
            ) {
                loginPromptedForAddLinkRef.current = addLinkKey;
            }
            return;
        }

        handledAddLinkRef.current = addLinkKey;
        setIsModalOpen(true);
        reset({ artistDataUrl: prefillUrl });

        const currentUrl = new URL(window.location.href);
        if (!currentUrl.searchParams.has("addLink")) return;

        currentUrl.searchParams.delete("addLink");
        window.history.replaceState(
            null,
            "",
            `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
        );
    }, [artist.id, isOpenOnLoad, prefillUrl, reset, session, status]);

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
        // The page only supplies prefillUrl after validating an exact Spotify or
        // Deezer artist URL on the server. If the optional client regex lookup
        // fails, let that untouched value reach the authoritative server write
        // path rather than stranding the handoff.
        if (platformRegexStatus === "error" && prefillUrl && url === prefillUrl) {
            return true;
        }

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
        if (platformRegexStatus === "loading") return;

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
            reset({ artistDataUrl: "" });
        }
        setIsModalOpen(isOpen);
    }

    function checkInput() {
        if (addArtistResp?.status === "success") {
            reset({ artistDataUrl: "" });
            setAddArtistResp(null);
        }
    }

    function handleClick() {
        // Session still resolving — don't flash a spurious login prompt at an authed user
        if (status === "loading") return;
        if (!session) {
            promptLogin();
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
                aria-label={label ?? `Add a link for ${artist.name ?? "this artist"}`}
                title={label ?? `Add a link for ${artist.name ?? "this artist"}`}
            >
                {label ? <span className="whitespace-nowrap">{label}</span> : <Plus color="white" size={24} aria-hidden="true" />}
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
                            {directEdit || autoApprove
                                ? `Add a link for ${artist.name}`
                                : `Suggest a link for ${artist.name}`}
                        </DialogTitle>
                        <DialogDescription className="text-xs text-muted-foreground">
                            {directEdit
                                ? "This link will be saved directly to the artist profile."
                                : autoApprove
                                    ? "This link will be added immediately and recorded as your contribution."
                                    : "An admin will review it before it’s added."}
                        </DialogDescription>
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
                                <Button
                                    type="submit"
                                    disabled={isLoading || platformRegexStatus === "loading"}
                                    aria-busy={isLoading || platformRegexStatus === "loading"}
                                    aria-label={directEdit ? "Save Link" : autoApprove ? "Add Link" : "Submit"}
                                    className="bg-pastypink hover:bg-pastypink/90 text-white"
                                >
                                    {platformRegexStatus === "loading" ? (
                                        <span>Loading supported links…</span>
                                    ) : isLoading ? (
                                        <img className="max-h-6" src="/spinner.svg" alt="submitting" />
                                    ) : (
                                        <span>{directEdit ? "Save Link" : autoApprove ? "Add Link" : "Submit"}</span>
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
