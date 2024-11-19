"use client"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
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
} from "@/components/ui/tooltip";
import { useState } from "react";
import { Artist } from "@/server/db/DbTypes";
import { AspectRatio } from "@radix-ui/react-aspect-ratio";
import { Label } from "@radix-ui/react-label";
import { Session } from "next-auth";
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
import { addArtistData, AddArtistDataResp, getUgcStats } from "@/server/utils/queriesTS";;
import { useMemo } from "react"
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";

export default function AddArtistData({ artist, spotifyImg, session, availableLinks }: { artist: Artist, spotifyImg: string, session: Session | null, availableLinks: UrlMap[] }) {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedOption, setSelectedOption] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [addArtistResp, setAddArtistResp] = useState<AddArtistDataResp | null>(null);
    const router = useRouter();
    const {toast} = useToast();
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

    async function onSubmit(values: z.infer<typeof formSchema>) {
        setAddArtistResp(null);
        setIsLoading(true);
        const resp = await addArtistData(values.artistDataUrl, artist);
        const ugcStats = await getUgcStats();
        if(resp.status === "success") {
            toast({
                title: `${artist.name}'s ${resp.siteName} added`,
                description: `UGC Count: ${ugcStats}`,
            })
        }
        setAddArtistResp(resp);
        setIsLoading(false);
    }

    function handleClose(isOpen: boolean) {
        if (!isOpen && addArtistResp && addArtistResp.status === "success") {
            router.refresh();
        }
        setIsModalOpen(isOpen);
        form.reset();
    }

    function checkInput() {
        if(addArtistResp?.status === "success") {
            form.reset();
            setAddArtistResp(null);
        }
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
            <Dialog open={isModalOpen} onOpenChange={handleClose}>
                <DialogContent className="sm:max-w-[425px] max-h-screen overflow-auto scrollbar-hide text-black">
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                                <div className="grid gap-4 text-black">
                                    <Label className="text-sm text-slate-500">
                                        Input one of the options below to add a new card
                                    </Label>
                                    <FormField
                                        control={form.control}
                                        name="artistDataUrl"
                                        render={({ field }) => (
                                            <FormItem>
                                                <div className="flex gap-4">
                                                    <FormControl>
                                                        <Input
                                                            placeholder={selectedOption}
                                                            onClick={checkInput}
                                                            id="name"
                                                            className="col-span-3 text-black border-2 border-black"
                                                            {...field}
                                                        />
                                                    </FormControl>
                                                    <AddArtistDataOptions availableLinks={availableLinks} setOption={(option) => setSelectedOption(option)} />
                                                </div>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                                <p>
                                    Once you submit the card we&apos;ll look it over to make sure it all checks out!
                                </p>
                                <DialogFooter className="flex sm:flex-col gap-4">
                                    {addArtistResp && addArtistResp.status === "error" ?
                                        <Label className="text-red-600">{addArtistResp.message}</Label> : null
                                    }
                                    <Button type="submit" className="">
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
