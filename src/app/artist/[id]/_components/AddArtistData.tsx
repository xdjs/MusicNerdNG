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
import { Input } from "@/components/ui/input"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { useSession } from "next-auth/react"
import { useState } from "react"
import { SessionProvider } from "next-auth/react";
import { Artist } from "@/server/db/DbTypes"
import { AspectRatio } from "@radix-ui/react-aspect-ratio"
import { Label } from "@radix-ui/react-label"

export default function Wrapper({ artist, spotifyImg }: { artist: Artist, spotifyImg: string }) {
    return (
        <SessionProvider>
            <AddArtistData artist={artist} spotifyImg={spotifyImg} />
        </SessionProvider>
    )
}
function AddArtistData({ artist, spotifyImg }: { artist: Artist, spotifyImg: string }) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const { data: session, status } = useSession();
    console.log("session:", session);
    console.log("status:", status);
    return (
        <>
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span tabIndex={0}>
                            <Button
                                className=""
                                disabled={session === null || status !== "authenticated"}
                                onClick={() => setIsModalOpen(true)} variant="outline"
                            >
                                Add Artist Data!
                            </Button>
                        </span>
                    </TooltipTrigger>
                    {session === null && (
                        <TooltipContent>
                            <p>Please Connect Wallet to Add Artist Data</p>
                        </TooltipContent>
                    )}
                </Tooltip>
            </TooltipProvider>
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>
                            Add Artist Data for {artist.name}
                        </DialogTitle>
                    </DialogHeader>
                    <div>
                        <AspectRatio ratio={1 / 1} className="flex items-center place-content-center bg-muted rounded-md overflow-hidden w-full">
                            {(spotifyImg) ?
                                <img src={spotifyImg} alt="Image not available" className="object-cover" />
                                :
                                <img className="" src="/spinner.svg" alt="whyyyyy" />
                            }
                        </AspectRatio>
                    </div>
                    <div className="grid gap-4">
                        <Label className="text-sm text-slate-500">
                            Input one of the options below to add a new card
                        </Label>
                        <Input
                            pattern="https://open.spotify.com/artist/[a-zA-Z0-9]+"
                            placeholder="https://open.spotify.com/artist/Id"
                            id="name"
                            className="col-span-3"
                        />
                        <p>
                            Once you submit the card we&apos;ll look it over to make sure it all checks out!
                        </p>
                    </div>
                    <DialogFooter>
                        <Button type="submit">Add Artist data</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
