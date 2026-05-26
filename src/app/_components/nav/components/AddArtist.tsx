"use client"

import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input";
import { useState } from "react";
import Link from "next/link";
import { z } from "zod";
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
import type { AddArtistResp } from "@/app/actions/serverActions";
import { cn } from "@/lib/utils";
import { Plus } from 'lucide-react';
import { useSession } from "next-auth/react";
import { useLogin } from "@privy-io/react-auth";

const spotifyArtistUrlRegex = /https:\/\/open\.spotify\.com\/artist\/([a-zA-Z0-9]+)/;
const deezerArtistUrlRegex = /https?:\/\/(www\.)?deezer\.com\/([\w-]+\/)?artist\/(\d+)/;

function parseArtistUrl(url: string): { id: string; platform: 'deezer' | 'spotify' } | null {
    const deezerMatch = url.match(deezerArtistUrlRegex);
    if (deezerMatch) return { id: deezerMatch[3], platform: 'deezer' };
    const spotifyMatch = url.match(spotifyArtistUrlRegex);
    if (spotifyMatch) return { id: spotifyMatch[1], platform: 'spotify' };
    return null;
}

const formSchema = z.object({
    artistUrl: z.string().refine(
        (val) => spotifyArtistUrlRegex.test(val) || deezerArtistUrlRegex.test(val),
        { message: "Enter a Spotify or Deezer artist URL (e.g. https://open.spotify.com/artist/... or https://www.deezer.com/artist/...)" },
    ),
})

export default function AddArtist() {
    const { data: session } = useSession();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [addedArtist, setAddedArtist] = useState<{ artistId: string | undefined, artistName: string | undefined } | null>(null);
    const [addArtistStatus, setAddArtistStatus] = useState<AddArtistResp | null>(null);
    const { login } = useLogin();

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        mode: "onSubmit",
        defaultValues: {
            artistUrl: "",
        },
    })

    async function onSubmit(values: z.infer<typeof formSchema>) {
        const parsed = parseArtistUrl(values.artistUrl);
        if (!parsed) return null;
        setIsLoading(true);
        const resp = await addArtist(parsed.id, parsed.platform);
        setAddArtistStatus(resp);
        setIsLoading(false);
        if (resp.status === "success" || resp.status === "exists") setAddedArtist({ artistId: resp.artistId, artistName: resp.artistName });
    }

    function closeModal(isOpen: boolean) {
        setIsModalOpen(isOpen);
        setAddArtistStatus(null);
        setAddedArtist(null);
        form.reset();
    }

    function handleAddArtistClick() {
        if (session) {
            setIsModalOpen(true);
        } else {
            login();
        }
    }

    return (
        <>
            <Button
                className="text-black p-3 bg-pastyblue rounded-lg border-none hover:bg-gray-200 transition-colors duration-300 w-10 h-10 sm:w-12 sm:h-12 shrink-0"
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
                            Add an artist by pasting their Spotify or Deezer URL
                        </DialogDescription>
                    </DialogHeader>
                    <Form {...form}>
                        <div className="space-y-8">
                            <FormField
                                control={form.control}
                                name="artistUrl"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Artist URL</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Paste a Spotify or Deezer artist URL" {...field} />
                                        </FormControl>
                                        <FormDescription>
                                            Copy the URL from the artist&apos;s Spotify or Deezer page
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
                                                <Button variant="outline">Add links for {addedArtist.artistName}</Button>
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
