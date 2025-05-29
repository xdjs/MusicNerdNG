"use client"
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Button } from "@/components/ui/button";
import { useEffect, useState } from 'react';
import { useSession } from "next-auth/react";
import { Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { addArtist } from "@/app/actions/addArtist";
import { useToast } from "@/hooks/use-toast";

export default function Login({ buttonChildren, buttonStyles = "bg-gray-100", isplaceholder = false }: { buttonChildren?: React.ReactNode, buttonStyles: string, isplaceholder?: boolean }) {
    const router = useRouter();
    const { toast } = useToast();
    const { data: session, status } = useSession();
    const [currentStatus, setCurrentStatus] = useState(status);
    const [isProcessingPendingArtist, setIsProcessingPendingArtist] = useState(false);

    useEffect(() => {
        // Handle post-login artist addition
        const handlePendingArtistAdd = async () => {
            if (status === "authenticated" && !isProcessingPendingArtist) {
                const pendingArtist = sessionStorage.getItem('pendingArtistAdd');
                if (pendingArtist) {
                    try {
                        setIsProcessingPendingArtist(true);
                        const artistData = JSON.parse(pendingArtist);
                        const addResult = await addArtist(artistData.spotify);
                        
                        if ((addResult.status === "success" || addResult.status === "exists") && addResult.artistId) {
                            await router.replace(`/artist/${addResult.artistId}`);
                        } else {
                            toast({
                                variant: "destructive",
                                title: "Error",
                                description: addResult.message || "Failed to add artist"
                            });
                        }
                    } catch (error) {
                        console.error("Error processing pending artist:", error);
                        toast({
                            variant: "destructive",
                            title: "Error",
                            description: "Failed to add artist after login"
                        });
                    } finally {
                        sessionStorage.removeItem('pendingArtistAdd');
                        setIsProcessingPendingArtist(false);
                    }
                }
            }
        };

        // Refresh page if auth status changes
        if (currentStatus !== status && currentStatus !== "loading") {
            setCurrentStatus(status);
            handlePendingArtistAdd();
        }
        setCurrentStatus(status);
    }, [status, currentStatus, router, isProcessingPendingArtist, toast]);

    return (
        <ConnectButton.Custom>
            {({
                account,
                chain,
                openAccountModal,
                openChainModal,
                openConnectModal,
                authenticationStatus,
                mounted,
            }) => {
                const ready = mounted && authenticationStatus !== 'loading';
                const connected =
                    ready &&
                    account &&
                    chain &&
                    (authenticationStatus === 'authenticated');

                if (!ready) {
                    return (
                        <Button className={` bg-gray-400 animate-pulse w-12 h-12 px-0`} size="lg" onClick={openConnectModal} type="button" >
                        </Button>
                    )
                }

                return (
                    <div>
                        {(() => {
                            if (!connected) {
                                return (
                                    <Button className={`hover:bg-gray-200 transition-colors duration-300 text-black px-0 w-12 h-12 bg-pastypink ${buttonStyles}`} id="login-btn" size="lg" onClick={openConnectModal} type="button" >
                                        {buttonChildren ?? <Wallet color="white" />}
                                    </Button>
                                );
                            }

                            if (chain.unsupported) {
                                return (
                                    <button onClick={openChainModal} type="button">
                                        Wrong network
                                    </button>
                                );
                            }

                            return (
                                <div style={{ display: 'flex', gap: 12 }}>
                                    <Button onClick={openAccountModal} type="button" className="bg-pastypink text-black px-3  hover:bg-gray-200 transition-colors duration-300" size="lg" >
                                        {isplaceholder ? <img className="max-h-6" src="/spinner.svg" alt="whyyyyy" />
                                            : <label className="text-xl">🥳</label>
                                        }
                                    </Button>
                                </div>
                            );
                        })()}
                    </div>
                );
            }}
        </ConnectButton.Custom>
    )
}

