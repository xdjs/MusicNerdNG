"use client"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Session } from "next-auth";
import { Spotify } from "react-spotify-embed";
import Link from "next/link";
import { set, z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormMessage,
    FormLabel,
    FormDescription,
} from "@/components/ui/form";
import { addArtist } from "@/app/actions/addArtist";
import type { AddArtistResp } from "@/server/utils/queriesTS";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useWatch } from "react-hook-form";
import { Plus } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { useConnectModal } from '@rainbow-me/rainbowkit';

const spotifyArtistUrlRegex = /https:\/\/open\.spotify\.com\/artist\/([a-zA-Z0-9]+)/;

const formSchema = z.object({
    artistSpotifyUrl: z.string().regex(spotifyArtistUrlRegex, {
        message: "Artist Spotify url must be in the format https://open.spotify.com/artist/YOURARTISTID",
    }),
})

export default function AddArtist({ session }: { session: Session | null }) {
    const router = useRouter();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [addedArtist, setAddedArtist] = useState<{ artistId: string | undefined, artistName: string | undefined } | null>(null);
    const [addArtistStatus, setAddArtistStatus] = useState<AddArtistResp | null>(null);
    const { toast } = useToast();
    const isWalletRequired = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT !== 'true';
    
    // Always call hooks, conditionally use their results
    const { openConnectModal } = useConnectModal();

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        mode: "onSubmit",
        defaultValues: {
            artistSpotifyUrl: "",
        },
    })

    const artistSpotifyUrl = useWatch({ control: form.control, name: "artistSpotifyUrl" });

    async function onSubmit(values: z.infer<typeof formSchema>) {
        const match = values.artistSpotifyUrl.match(spotifyArtistUrlRegex);
        if (!match) return null;
        const artistId = match[1]
        setIsLoading(true);
        const resp = await addArtist(artistId);
        setAddArtistStatus(resp);
        setIsLoading(false);
        if (resp.status === "success" || resp.status === "exists") setAddedArtist({ artistId: resp.artistId, artistName: resp.artistName });
    }

    function checkAddedArtistStatus() {
        if (addArtistStatus?.artistId) form.setValue("artistSpotifyUrl", "");
        setAddArtistStatus(null);
        setAddedArtist(null);
    }

    function closeModal(isOpen: boolean) {
        setIsModalOpen(isOpen);
        setAddArtistStatus(null);
        setAddedArtist(null);
        form.reset();
    }

    function handleAddArtistClick() {
        if (!isWalletRequired || session != null) {
            setIsModalOpen(true);
            return;
        }
        if (openConnectModal) {
            openConnectModal();
        }
    }

    // Return a placeholder div in non-wallet mode to maintain layout
    if (!isWalletRequired) {
        return (
            <>
                <Button
                    className="text-black p-3 bg-pastyblue rounded-lg border-none hover:bg-gray-200 transition-colors duration-300 w-12 h-12"
                    onClick={handleAddArtistClick}
                    size="lg"
                >
                    <Plus color="white" />
                </Button>

                <Dialog open={isModalOpen} onOpenChange={closeModal}>
                    <DialogContent className="max-w-sm px-4 sm:max-w-[700px] max-h-screen overflow-auto scrollbar-hide text:black rounded-lg" >
                        <DialogHeader>
                            <DialogTitle>Add Artist</DialogTitle>
                            <DialogDescription>
                                Add an artist by pasting their Spotify URL
                            </DialogDescription>
                        </DialogHeader>
                        <Form {...form}>
                            <div className="space-y-8">
                                <FormField
                                    control={form.control}
                                    name="artistSpotifyUrl"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Spotify URL</FormLabel>
                                            <FormControl>
                                                <Input placeholder="https://open.spotify.com/artist/..." {...field} />
                                            </FormControl>
                                            <FormDescription>
                                                Copy the URL from the artist&apos;s Spotify page
                                            </FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <div>
                                    <Button onClick={form.handleSubmit(onSubmit)} className="w-auto self-start bg-pastypink">
                                        {isLoading ?
                                            <img className="max-h-6" src="/spinner.svg" alt="whyyyyy" />
                                            : <span>Add Artist</span>
                                        }
                                    </Button>
                                    {addArtistStatus &&
                                        <p className={cn(addArtistStatus.status === "error" ? "text-red-500" : "text-green-500")}>
                                            {addArtistStatus.message}
                                        </p>
                                    }
                                    <div className="flex flex-col gap-2 text-black overflow-auto">
                                        {addedArtist &&
                                            <>
                                                <Link onMouseDown={() => setIsModalOpen(false)} href={`/artist/${addedArtist.artistId}`} key="check-out">
                                                    <Button variant="outline">Check out {addedArtist.artistName}</Button>
                                                </Link>
                                                <Link onMouseDown={() => setIsModalOpen(false)} href={`/artist/${addedArtist.artistId}?opADM=1`} key="add-data">
                                                    <Button variant="outline">Add data for {addedArtist.artistName}</Button>
                                                </Link>
                                            </>
                                        }
                                    </div>
                                </div>
                            </div>
                        </Form>
                    </DialogContent>
                </Dialog>
            </>
        );
    }

    return (
        <>
            <Button
                className="text-black p-3 bg-pastyblue rounded-lg border-none hover:bg-gray-200 transition-colors duration-300 w-12 h-12"
                onClick={handleAddArtistClick}
                size="lg"
            >
                <Plus color="white" />
            </Button>

            <Dialog open={isModalOpen} onOpenChange={closeModal}>
                <DialogContent className="max-w-sm px-4 sm:max-w-[700px] max-h-screen overflow-auto scrollbar-hide text:black rounded-lg" >
                    <DialogHeader>
                        <DialogTitle>Add Artist</DialogTitle>
                        <DialogDescription>
                            Add an artist by pasting their Spotify URL
                        </DialogDescription>
                    </DialogHeader>
                    <Form {...form}>
                        <div className="space-y-8">
                            <FormField
                                control={form.control}
                                name="artistSpotifyUrl"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Spotify URL</FormLabel>
                                        <FormControl>
                                            <Input placeholder="https://open.spotify.com/artist/..." {...field} />
                                        </FormControl>
                                        <FormDescription>
                                            Copy the URL from the artist&apos;s Spotify page
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <div>
                                <Button onClick={form.handleSubmit(onSubmit)} className="w-auto self-start bg-pastypink">
                                    {isLoading ?
                                        <img className="max-h-6" src="/spinner.svg" alt="whyyyyy" />
                                        : <span>Add Artist</span>
                                    }
                                </Button>
                                {addArtistStatus &&
                                    <p className={cn(addArtistStatus.status === "error" ? "text-red-500" : "text-green-500")}>
                                        {addArtistStatus.message}
                                    </p>
                                }
                                <div className="flex flex-col gap-2 text-black overflow-auto">
                                    {addedArtist &&
                                        <>
                                            <Link onMouseDown={() => setIsModalOpen(false)} href={`/artist/${addedArtist.artistId}`} key="check-out">
                                                <Button variant="outline">Check out {addedArtist.artistName}</Button>
                                            </Link>
                                            <Link onMouseDown={() => setIsModalOpen(false)} href={`/artist/${addedArtist.artistId}?opADM=1`} key="add-data">
                                                <Button variant="outline">Add data for {addedArtist.artistName}</Button>
                                            </Link>
                                        </>
                                    }
                                </div>
                            </div>
                        </div>
                    </Form>
                </DialogContent>
            </Dialog>
        </>
    );
}
