"use client"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input"
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
import { addArtistData, AddArtistDataResp } from "@/server/utils/queriesTS";;
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import { Plus } from "lucide-react";
import { useConnectModal } from '@rainbow-me/rainbowkit';

export default function AddArtistData({ artist, spotifyImg, session, availableLinks, isOpenOnLoad = false, label }: { artist: Artist, spotifyImg: string, session: Session | null, availableLinks: UrlMap[], isOpenOnLoad: boolean, label?: string }) {
    const [isModalOpen, setIsModalOpen] = useState(isOpenOnLoad);
    const [selectedOption, setSelectedOption] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [addArtistResp, setAddArtistResp] = useState<AddArtistDataResp | null>(null);
    const router = useRouter();
    const { toast } = useToast();
    const isWalletRequired = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT !== 'true';
    
    // Always call hooks, conditionally use their results
    const { openConnectModal } = useConnectModal();

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
        if (resp.status === "success") {
            toast({
                title: `${artist.name}'s ${resp.siteName} added`,
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
            setSelectedOption("");
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
        if (!isWalletRequired || session) {
            setIsModalOpen(true);
        } else if (openConnectModal) {
            openConnectModal();
        }
    }

    return (
        <>
            <Button
                className="text-white bg-pastypink flex items-center gap-2 px-3 py-2 min-w-[50px]"
                onClick={handleClick}
            >
                <Plus />
                {label && <span className="whitespace-nowrap">{label}</span>}
            </Button>
            <Dialog open={isModalOpen} onOpenChange={handleClose}>
                <DialogContent className="sm:max-w-[425px] max-h-screen overflow-auto scrollbar-hide text-black">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                            <div>
                                <AspectRatio ratio={1 / 1} className="flex items-center place-content-center bg-muted rounded-md overflow-hidden w-full">
                                    {(spotifyImg) &&
                                        <img src={spotifyImg} alt="Artist Image" className="object-cover" />
                                    }
                                </AspectRatio>
                            </div>
                            <DialogHeader>
                                <DialogTitle>
                                    <p>
                                        Add a place where {artist.name} can be found
                                    </p>
                                </DialogTitle>
                            </DialogHeader>
                            <div className="grid gap-4 text-black">
                                <FormField
                                    control={form.control}
                                    name="artistDataUrl"
                                    render={({ field }) => (
                                        <FormItem>
                                            <div className="flex gap-4">
                                                <FormControl>
                                                    <div className="flex-grow px-3 py-0 bg-gray-100 rounded-lg flex items-center gap-2 h-12 hover:bg-gray-200 transition-colors duration-300">
                                                        <Input
                                                            placeholder={selectedOption}
                                                            onClick={checkInput}
                                                            id="name"
                                                            className="w-full p-0 bg-transparent focus:outline-none text-md"
                                                            {...field}
                                                        />
                                                    </div>
                                                </FormControl>
                                                <AddArtistDataOptions availableLinks={availableLinks} setOption={(option) => setSelectedOption(option)} />
                                            </div>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                            <p>
                                Once you submit the link we&apos;ll look it over to make sure it all checks out!
                            </p>
                            <DialogFooter className="flex sm:flex-col gap-4">
                                {addArtistResp && addArtistResp.status === "error" ?
                                    <Label className="text-red-600">{addArtistResp.message}</Label> : null
                                }
                                <Button type="submit" className="bg-pastyblue hover:bg-gray-400 text-white">
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
