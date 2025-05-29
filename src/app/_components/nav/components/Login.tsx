"use client"
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Button } from "@/components/ui/button";
import { useEffect, useState, useCallback } from 'react';
import { useSession, signIn } from "next-auth/react";
import { Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { addArtist } from "@/app/actions/addArtist";
import { useToast } from "@/hooks/use-toast";
import { useAccount, useSignMessage } from 'wagmi';
import { SiweMessage } from 'siwe';

export default function Login({ buttonChildren, buttonStyles = "bg-gray-100", isplaceholder = false }: { buttonChildren?: React.ReactNode, buttonStyles: string, isplaceholder?: boolean }) {
    const router = useRouter();
    const { toast } = useToast();
    const { data: session, status } = useSession();
    const [currentStatus, setCurrentStatus] = useState(status);
    const [isProcessingPendingArtist, setIsProcessingPendingArtist] = useState(false);
    const { isConnected, address } = useAccount();
    const [lastProcessedAddress, setLastProcessedAddress] = useState<string | undefined>();

    // Memoize the handler to prevent unnecessary re-renders
    const handlePendingArtistAdd = useCallback(async () => {
        console.log("[Login] Checking for pending artist:", {
            status,
            isConnected,
            address,
            lastProcessedAddress,
            isProcessing: isProcessingPendingArtist,
            session: session?.user
        });

        // Wait for session to be properly established
        if (status === "loading") {
            console.log("[Login] Session still loading, waiting...");
            return;
        }

        // Only process if we haven't handled this address yet and we have a session
        if (!session?.user?.id || !session?.user?.walletAddress) {
            console.log("[Login] No session user data yet");
            return;
        }

        if (address === lastProcessedAddress) {
            console.log("[Login] Already processed this address, skipping");
            return;
        }

        if (status === "authenticated" && isConnected && !isProcessingPendingArtist) {
            const pendingArtist = sessionStorage.getItem('pendingArtistAdd');
            console.log("[Login] Found pending artist data:", pendingArtist);
            
            if (pendingArtist) {
                try {
                    setIsProcessingPendingArtist(true);
                    const artistData = JSON.parse(pendingArtist);
                    
                    if (artistData.isSpotifyOnly) {
                        console.log("[Login] Processing Spotify artist addition:", artistData);
                        
                        // Add a small delay to ensure session is fully established
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        const addResult = await addArtist(artistData.spotify);
                        console.log("[Login] Add artist result:", addResult);
                        
                        if ((addResult.status === "success" || addResult.status === "exists") && addResult.artistId) {
                            console.log("[Login] Successfully added artist, redirecting to:", addResult.artistId);
                            // Clear storage and update last processed address before navigation
                            sessionStorage.removeItem('pendingArtistAdd');
                            setLastProcessedAddress(address);
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
    }, [status, isConnected, address, lastProcessedAddress, isProcessingPendingArtist, router, toast, session]);

    useEffect(() => {
        console.log("[Login] State changed:", {
            authFrom: currentStatus,
            authTo: status,
            isConnected,
            address,
            lastProcessedAddress,
            sessionUser: session?.user
        });

        // Update current status if it changed
        if (status !== currentStatus) {
            setCurrentStatus(status);
        }

        // Process pending artist if we're authenticated and connected
        if (status === "authenticated" && isConnected && session?.user?.id && session?.user?.walletAddress) {
            handlePendingArtistAdd();
        }
    }, [status, currentStatus, isConnected, address, handlePendingArtistAdd, lastProcessedAddress, session]);

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
                                    <Button 
                                        className={`hover:bg-gray-200 transition-colors duration-300 text-black px-0 w-12 h-12 bg-pastypink ${buttonStyles}`} 
                                        id="login-btn" 
                                        size="lg" 
                                        onClick={openConnectModal} 
                                        type="button"
                                    >
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

