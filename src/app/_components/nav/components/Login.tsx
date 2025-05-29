"use client"
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Button } from "@/components/ui/button";
import { useEffect, useState } from 'react';
import { useSession } from "next-auth/react";
import { Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { addArtist } from "@/app/actions/addArtist";
import { useToast } from "@/hooks/use-toast";
import { useAccount } from 'wagmi';

export default function Login({ buttonChildren, buttonStyles = "bg-gray-100", isplaceholder = false }: { buttonChildren?: React.ReactNode, buttonStyles: string, isplaceholder?: boolean }) {
    const router = useRouter();
    const { toast } = useToast();
    const { data: session, status } = useSession();
    const [currentStatus, setCurrentStatus] = useState(status);
    const [isProcessingPendingArtist, setIsProcessingPendingArtist] = useState(false);
    const { isConnected } = useAccount();

    useEffect(() => {
        // Handle post-login artist addition
        const handlePendingArtistAdd = async () => {
            console.log("[Login] Checking for pending artist, auth status:", status, "isConnected:", isConnected);
            if (status === "authenticated" && isConnected && !isProcessingPendingArtist) {
                const pendingArtist = sessionStorage.getItem('pendingArtistAdd');
                console.log("[Login] Found pending artist data:", pendingArtist);
                if (pendingArtist) {
                    try {
                        setIsProcessingPendingArtist(true);
                        const artistData = JSON.parse(pendingArtist);
                        
                        // Only handle Spotify artist additions after login
                        if (artistData.isSpotifyOnly) {
                            console.log("[Login] Processing Spotify artist addition:", artistData.name);
                            const addResult = await addArtist(artistData.spotify);
                            
                            if ((addResult.status === "success" || addResult.status === "exists") && addResult.artistId) {
                                console.log("[Login] Successfully added artist, redirecting to:", addResult.artistId);
                                // Clear storage before navigation
                                sessionStorage.removeItem('pendingArtistAdd');
                                await router.replace(`/artist/${addResult.artistId}`);
                            } else {
                                console.error("[Login] Failed to add artist:", addResult);
                                toast({
                                    variant: "destructive",
                                    title: "Error",
                                    description: addResult.message || "Failed to add artist"
                                });
                            }
                        } else {
                            console.log("[Login] Skipping non-Spotify artist");
                        }
                    } catch (error) {
                        console.error("[Login] Error processing pending artist:", error);
                        toast({
                            variant: "destructive",
                            title: "Error",
                            description: "Failed to add artist after login"
                        });
                    } finally {
                        sessionStorage.removeItem('pendingArtistAdd');
                        setIsProcessingPendingArtist(false);
                    }
                } else {
                    console.log("[Login] No pending artist found");
                }
            }
        };

        // Handle auth status changes
        if (status !== currentStatus || isConnected) {
            console.log("[Login] Auth/Connection status changed:", { 
                authFrom: currentStatus, 
                authTo: status,
                isConnected: isConnected 
            });
            setCurrentStatus(status);
            if (status === "authenticated" && isConnected) {
                console.log("[Login] User authenticated and connected, handling pending artist");
                handlePendingArtistAdd();
            }
        }
    }, [status, currentStatus, router, isProcessingPendingArtist, toast, isConnected]);

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
                    console.log("[Login] Component not ready, showing loading state");
                    return (
                        <Button className={` bg-gray-400 animate-pulse w-12 h-12 px-0`} size="lg" onClick={openConnectModal} type="button" >
                        </Button>
                    )
                }

                return (
                    <div>
                        {(() => {
                            if (!connected) {
                                console.log("[Login] User not connected, showing login button");
                                return (
                                    <Button className={`hover:bg-gray-200 transition-colors duration-300 text-black px-0 w-12 h-12 bg-pastypink ${buttonStyles}`} id="login-btn" size="lg" onClick={openConnectModal} type="button" >
                                        {buttonChildren ?? <Wallet color="white" />}
                                    </Button>
                                );
                            }

                            if (chain.unsupported) {
                                console.log("[Login] Unsupported chain detected");
                                return (
                                    <button onClick={openChainModal} type="button">
                                        Wrong network
                                    </button>
                                );
                            }

                            console.log("[Login] User connected, showing account button");
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

