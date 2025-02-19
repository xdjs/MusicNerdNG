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
} from "@/components/ui/form";
import { addArtist, AddArtistResp } from "@/server/utils/queriesTS";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useWatch } from "react-hook-form";
import { Plus } from 'lucide-react';

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
        if (session != null) {
            setIsModalOpen(true);
            return;
        }
        const loginBtn = document.getElementById("login-btn");
        if (loginBtn) {
            loginBtn.click();
        }
    }

    return (
        <>

            <Button
                className="text-black p-3 bg-pastyblue rounded-lg border-none hover:bg-gray-200 transition-colors duration-300"
                onClick={handleAddArtistClick}
                size="lg"
            >
                <Plus color="white" />
            </Button>

            <Dialog open={isModalOpen} onOpenChange={closeModal} >
                <DialogContent className="max-w-sm px-4 sm:max-w-[700px] max-h-screen overflow-auto scrollbar-hide text:black rounded-lg" >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 justify-items-center">
                        {spotifyArtistUrlRegex.test(form.getValues().artistSpotifyUrl) ?
                            <Spotify link={artistSpotifyUrl} /> :
                            <div className="w-[300px] h-[380px] rounded-lg bg-black flex justify-center items-center text-white">
                                <img src="/siteIcons/spotify_icon.png" alt="logo" className="w-36" />
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
                                                    <div className="flex-grow px-3 py-0 bg-gray-100 rounded-lg flex items-center gap-2 h-12 hover:bg-gray-200 transition-colors duration-300">
                                                        <Input
                                                            placeholder="https://open.spotify.com/artist/Id"
                                                            onClick={checkAddedArtistStatus}
                                                            id="name"
                                                            className="w-full p-0 bg-transparent focus:outline-none"
                                                            {...field}
                                                        />
                                                    </div>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                                <DialogFooter className="flex sm:flex-col gap-2 sm:justify-start">
                                    <Button type="submit" className="w-auto self-start bg-pastypink">
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
                                                <Link onMouseDown={() => setIsModalOpen(false)} href={`/artist/${addedArtist.artistId}`} key={addedArtist.artistId}>
                                                    <Button variant="outline">Check out {addedArtist.artistName}</Button>
                                                </Link>
                                                <Link onMouseDown={() => setIsModalOpen(false)} href={`/artist/${addedArtist.artistId}?opADM=1`} key={addedArtist.artistId}>
                                                    <Button variant="outline">Add data for {addedArtist.artistName}</Button>
                                                </Link>
                                            </>
                                        }
                                    </div>
                                </DialogFooter>
                            </form>
                        </Form>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    )
}
