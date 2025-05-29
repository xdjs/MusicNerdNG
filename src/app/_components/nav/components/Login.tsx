"use client"
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Button } from "@/components/ui/button";
import { useEffect, useState, useCallback } from 'react';
import { useSession, signOut } from "next-auth/react";
import { Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { addArtist } from "@/app/actions/addArtist";
import { useToast } from "@/hooks/use-toast";
import { useAccount, useDisconnect, useConfig } from 'wagmi';
import { useConnectModal, useAccountModal, useChainModal } from '@rainbow-me/rainbowkit';

export default function Login({ buttonChildren, buttonStyles = "bg-gray-100", isplaceholder = false }: { buttonChildren?: React.ReactNode, buttonStyles: string, isplaceholder?: boolean }) {
    const router = useRouter();
    const { toast } = useToast();
    const { data: session, status, update: updateSession } = useSession();
    const [currentStatus, setCurrentStatus] = useState(status);
    const [isProcessingPendingArtist, setIsProcessingPendingArtist] = useState(false);
    const { isConnected, address } = useAccount();
    const { disconnect } = useDisconnect();
    const { openConnectModal } = useConnectModal();
    const { openAccountModal } = useAccountModal();
    const { openChainModal } = useChainModal();
    const [lastProcessedAddress, setLastProcessedAddress] = useState<string | undefined>();
    const config = useConfig();
    const [hasAttemptedProcess, setHasAttemptedProcess] = useState(false);

    // Handle disconnection and cleanup
    const handleDisconnect = useCallback(async () => {
        try {
            console.log("[Login] Disconnecting wallet and cleaning up session");
            await signOut({ redirect: false });
            disconnect();
            sessionStorage.removeItem('pendingArtistAdd');
            setLastProcessedAddress(undefined);
            setHasAttemptedProcess(false);
            
            toast({
                title: "Disconnected",
                description: "Your wallet has been disconnected",
            });
        } catch (error) {
            console.error("[Login] Error during disconnect:", error);
            toast({
                variant: "destructive",
                title: "Error",
                description: "Failed to disconnect wallet"
            });
        }
    }, [disconnect, toast]);

    // Memoize the handler to prevent unnecessary re-renders
    const handlePendingArtistAdd = useCallback(async () => {
        if (isProcessingPendingArtist || hasAttemptedProcess) {
            console.log("[Login] Already processing or attempted, skipping");
            return;
        }

        console.log("[Login] Checking for pending artist:", {
            status,
            isConnected,
            address,
            lastProcessedAddress,
            isProcessing: isProcessingPendingArtist,
            session: session?.user
        });

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

        // Check if we have a pending artist and we're authenticated
        if (status === "authenticated" && isConnected) {
            const pendingArtist = sessionStorage.getItem('pendingArtistAdd');
            console.log("[Login] Found pending artist data:", pendingArtist);
            
            if (pendingArtist) {
                try {
                    setIsProcessingPendingArtist(true);
                    setHasAttemptedProcess(true);
                    const artistData = JSON.parse(pendingArtist);
                    
                    // Check if the stored data is too old (more than 5 minutes)
                    const isDataStale = artistData.timestamp && (Date.now() - artistData.timestamp > 5 * 60 * 1000);
                    if (isDataStale) {
                        console.log("[Login] Pending artist data is stale, removing");
                        sessionStorage.removeItem('pendingArtistAdd');
                        setIsProcessingPendingArtist(false);
                        return;
                    }
                    
                    if (artistData.isSpotifyOnly && artistData.spotify) {
                        console.log("[Login] Processing Spotify artist addition:", artistData);
                        
                        // Add a small delay to ensure session is fully established
                        await new Promise(resolve => setTimeout(resolve, 1500));
                        
                        const addResult = await addArtist(artistData.spotify);
                        console.log("[Login] Add artist result:", addResult);
                        
                        if ((addResult.status === "success" || addResult.status === "exists") && addResult.artistId) {
                            console.log("[Login] Successfully added artist, redirecting to:", addResult.artistId);
                            // Clear storage and update last processed address before navigation
                            sessionStorage.removeItem('pendingArtistAdd');
                            setLastProcessedAddress(address);
                            // Add a small delay before navigation to ensure state is updated
                            await new Promise(resolve => setTimeout(resolve, 500));
                            router.push(`/artist/${addResult.artistId}`);
                        } else {
                            console.error("[Login] Failed to add artist:", addResult);
                            toast({
                                variant: "destructive",
                                title: "Error",
                                description: addResult.message || "Failed to add artist"
                            });
                            sessionStorage.removeItem('pendingArtistAdd');
                        }
                    } else {
                        console.log("[Login] Invalid or non-Spotify artist data");
                        sessionStorage.removeItem('pendingArtistAdd');
                    }
                } catch (error) {
                    console.error("[Login] Error processing pending artist:", error);
                    toast({
                        variant: "destructive",
                        title: "Error",
                        description: "Failed to add artist after login"
                    });
                    sessionStorage.removeItem('pendingArtistAdd');
                } finally {
                    setIsProcessingPendingArtist(false);
                }
            } else {
                console.log("[Login] No pending artist found");
            }
        }
    }, [status, isConnected, address, lastProcessedAddress, isProcessingPendingArtist, router, toast, session, hasAttemptedProcess]);

    useEffect(() => {
        console.log("[Login] State changed:", {
            authFrom: currentStatus,
            authTo: status,
            isConnected,
            address,
            lastProcessedAddress,
            sessionUser: session?.user
        });

        if (status !== currentStatus) {
            setCurrentStatus(status);
            
            // If we're transitioning from unauthenticated to authenticated,
            // wait a bit before processing pending artist to ensure SIWE is complete
            if (currentStatus === "unauthenticated" && status === "authenticated") {
                setTimeout(() => {
                    handlePendingArtistAdd();
                }, 1000);
                return;
            }
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
                mounted,
            }) => {
                const ready = mounted;

                if (!ready || !config) {
                    return (
                        <Button className="bg-pastypink animate-pulse w-12 h-12 px-0" size="lg" type="button">
                            <img className="max-h-6" src="/spinner.svg" alt="Loading..." />
                        </Button>
                    );
                }

                if (!isConnected || status !== "authenticated") {
                    console.log("[Login] User not connected or not authenticated, showing connect button");
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

                console.log("[Login] User connected and authenticated, showing account button");
                return (
                    <div style={{ display: 'flex', gap: 12 }}>
                        <Button 
                            onClick={openAccountModal}
                            type="button" 
                            className="bg-pastypink hover:bg-pastypink/80 transition-colors duration-300 w-12 h-12 p-0 flex items-center justify-center" 
                            size="lg"
                        >
                            {isplaceholder ? (
                                <img className="max-h-6" src="/spinner.svg" alt="Loading..." />
                            ) : (
                                <span className="text-xl">🥳</span>
                            )}
                        </Button>
                    </div>
                );
            }}
        </ConnectButton.Custom>
    );
}

