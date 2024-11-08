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
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { useState } from "react";
import { Session } from "next-auth";
import { Spotify } from "react-spotify-embed";

import { set, z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormMessage,
} from "@/components/ui/form";
import { addArtist } from "@/server/utils/queriesTS";
import { useRouter } from "next/navigation";

const spotifyArtistUrlRegex = /https:\/\/open\.spotify\.com\/artist\/([a-zA-Z0-9]+)/;

const formSchema = z.object({
    artistSpotifyUrl: z.string().regex(spotifyArtistUrlRegex, {
        message: "Artist Spotify url must be in the format https://open.spotify.com/artist/YOURARTISTID",
    }),
})

export default function AddArtist({ session }: { session: Session | null }) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [errorText, setErrorText] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const router = useRouter();
    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        mode: "onSubmit",
        defaultValues: {
            artistSpotifyUrl: "https://open.spotify.com/artist/YOURARTISTID",
        },
    })

    async function onSubmit(values: z.infer<typeof formSchema>) {
        const match = values.artistSpotifyUrl.match(spotifyArtistUrlRegex);
        if (!match) return null;
        const artistId = match[1]
        setIsLoading(true);
        const resp = await addArtist(artistId);
        if (resp.status === "error") {
            return;
        }
        setIsLoading(false);
        setIsModalOpen(false);
        router.push("/artist/" + resp.artistId);
    }

    return (
        <>
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span tabIndex={0}>
                            <Button
                                className="text-black"
                                disabled={session === null}
                                onClick={() => setIsModalOpen(true)} variant="outline"
                            >
                                Add Artist
                            </Button>
                        </span>
                    </TooltipTrigger>
                    {session === null && (
                        <TooltipContent>
                            <p>Please Connect Wallet to Add Artists</p>
                        </TooltipContent>
                    )}
                </Tooltip>
            </TooltipProvider>
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent className="max-w-sm sm:max-w-[700px] max-h-screen overflow-auto scrollbar-hide " >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 justify-items-center">
                        {spotifyArtistUrlRegex.test(form.getValues().artistSpotifyUrl) ?
                            <Spotify link={form.getValues().artistSpotifyUrl} /> :
                            <div className="w-[300px] h-[380px] rounded-lg bg-pastyblue flex justify-center items-center text-white">
                                <h2>Enter a valid Spotify url</h2>
                            </div>
                        }
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 w-full">
                                <DialogHeader>
                                    <DialogTitle>Add Artist!</DialogTitle>
                                    <DialogDescription>
                                        Let&apos;s start by inputting their Spotify artist ID
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-4 py-4">
                                    <FormField
                                        control={form.control}
                                        name="artistSpotifyUrl"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <Input placeholder="https://open.spotify.com/artist/Id" {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                                <DialogFooter>
                                    <Button type="submit">
                                        {isLoading ?
                                            <img className="max-h-6" src="/spinner.svg" alt="whyyyyy" />
                                            : <span>Add Artist</span>
                                        }
                                    </Button>
                                </DialogFooter>
                            </form>
                        </Form>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    )
}
