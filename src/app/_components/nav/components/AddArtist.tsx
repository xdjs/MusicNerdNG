"use client"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input";
import Login from "./login";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { Session } from "next-auth";
import { useSession } from "next-auth/react";
import { useState } from "react";
import { SessionProvider } from "next-auth/react";
export default function Wrapper({ pageProps }: { pageProps: Session }) {
    return (
        <SessionProvider>
            <AddArtist pageProps={pageProps} />
        </SessionProvider>
    )
}

function AddArtist({ pageProps }: { pageProps: Session }) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const { data: session, status } = useSession();
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
                <DialogContent className="sm:max-w-[425px]" >
                    <DialogHeader>
                        <DialogTitle>Add Artist!</DialogTitle>
                        <DialogDescription>
                            Let&apos;s start by inputting their Spotify artist ID
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <Input
                            pattern="https://open.spotify.com/artist/[a-zA-Z0-9]+"
                            placeholder="https://open.spotify.com/artist/Id"
                            id="name"
                            className="col-span-3"
                        />
                    </div>
                    <DialogFooter>
                        <Button type="submit">Add Artists</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
