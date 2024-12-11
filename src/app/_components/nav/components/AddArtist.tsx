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
import { useEffect, useState } from "react";
import { Session } from "next-auth";
import { Spotify } from "react-spotify-embed";
import Login from "./Login"
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
        if (resp.status === "success") setAddedArtist({ artistId: resp.artistId, artistName: resp.artistName });
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


    return (
        <>
            {session != null ?
                <Button
                    className="text-black"
                    onClick={() => setIsModalOpen(true)} variant="outline"
                >
                    Add Artist
                </Button>
                :
                <Login buttonText="Add Artist" buttonStyles="text-black bg-white" />
            }
            <Dialog open={isModalOpen} onOpenChange={closeModal}>
                <DialogContent className="max-w-sm sm:max-w-[700px] max-h-screen overflow-auto scrollbar-hide text:black" >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 justify-items-center">
                        {spotifyArtistUrlRegex.test(form.getValues().artistSpotifyUrl) ?
                            <Spotify link={artistSpotifyUrl} /> :
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
                                                    <Input onClick={checkAddedArtistStatus} className="border-black border-2 text-black" placeholder="https://open.spotify.com/artist/Id" {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                                <DialogFooter className="flex sm:flex-col gap-2 sm:justify-start">
                                    <Button type="submit" className="w-auto self-start">
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
                                            <Link onMouseDown={() => setIsModalOpen(false)} href={`/artist/${addedArtist.artistId}`} key={addedArtist.artistId}>
                                                <Button variant="outline">Check out {addedArtist.artistName}</Button>
                                            </Link>
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
