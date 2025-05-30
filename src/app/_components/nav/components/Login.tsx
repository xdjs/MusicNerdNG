"use client"
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Button } from "@/components/ui/button";
import { useEffect, useState, useCallback, forwardRef } from 'react';
import { useSession, signOut } from "next-auth/react";
import { Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from "@/hooks/use-toast";
import { useAccount, useDisconnect, useConfig } from 'wagmi';
import { useConnectModal, useAccountModal, useChainModal } from '@rainbow-me/rainbowkit';
import { addArtist } from "@/app/actions/addArtist";
import type { AddArtistResp } from "@/app/actions/addArtist";

// Add type for the SearchBar ref
interface SearchBarRef {
    clearLoading: () => void;
}

const Login = forwardRef<HTMLButtonElement, { 
    buttonChildren?: React.ReactNode, 
    buttonStyles: string, 
    isplaceholder?: boolean,
    searchBarRef?: React.RefObject<SearchBarRef>
}>(({ buttonChildren, buttonStyles = "bg-gray-100", isplaceholder = false, searchBarRef }, ref) => {
    const router = useRouter();
    const { toast } = useToast();
    const { data: session, status } = useSession();
    const [currentStatus, setCurrentStatus] = useState(status);
    const { isConnected, address } = useAccount();
    const { disconnect } = useDisconnect();
    const config = useConfig();
    const { openConnectModal } = useConnectModal();

    // Handle disconnection and cleanup
    const handleDisconnect = useCallback(async () => {
        try {
            console.log("[Login] Disconnecting wallet and cleaning up session");
            
            // Clean up all stored data
            sessionStorage.removeItem('searchFlow');
            sessionStorage.removeItem('directLogin');
            sessionStorage.removeItem('pendingArtistSpotifyId');
            sessionStorage.removeItem('pendingArtistName');
            
            // Disconnect wallet and sign out
            await signOut({ redirect: false });
            disconnect();
            
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

    useEffect(() => {
        console.log("[Login] State changed:", {
            authFrom: currentStatus,
            authTo: status,
            isConnected,
            address,
            sessionUser: session?.user,
            isSearchFlow: sessionStorage.getItem('searchFlow'),
            pendingArtist: sessionStorage.getItem('pendingArtistName')
        });

        // Handle successful authentication
        if (isConnected && session && sessionStorage.getItem('searchFlow')) {
            const pendingArtistId = sessionStorage.getItem('pendingArtistSpotifyId');
            const pendingArtistName = sessionStorage.getItem('pendingArtistName');
            
            if (pendingArtistId) {
                console.log("[Login] Auth completed, adding pending artist:", pendingArtistName);
                // Clean up stored data
                sessionStorage.removeItem('searchFlow');
                sessionStorage.removeItem('pendingArtistSpotifyId');
                sessionStorage.removeItem('pendingArtistName');
                
                // Add the artist
                addArtist(pendingArtistId)
                    .then(async (result: AddArtistResp) => {
                        if ((result.status === "success" || result.status === "exists") && result.artistId) {
                            // Navigate and clear loading state
                            await router.replace(`/artist/${result.artistId}`);
                            // Clear loading state after navigation
                            if (searchBarRef?.current) {
                                searchBarRef.current.clearLoading();
                            }
                        } else {
                            // Clear loading state on error
                            if (searchBarRef?.current) {
                                searchBarRef.current.clearLoading();
                            }
                            toast({
                                variant: "destructive",
                                title: "Error",
                                description: result.message || "Failed to add artist"
                            });
                        }
                    })
                    .catch((error: Error) => {
                        // Clear loading state on error
                        if (searchBarRef?.current) {
                            searchBarRef.current.clearLoading();
                        }
                        console.error("[Login] Error adding pending artist:", error);
                        toast({
                            variant: "destructive",
                            title: "Error",
                            description: "Failed to add artist - please try again"
                        });
                    });
            }
        }

        // Handle search flow reconnection
        if (sessionStorage.getItem('searchFlow') && !session && status === "unauthenticated") {
            console.log("[Login] Detected search flow without session, initiating connection");
            if (openConnectModal) {
                openConnectModal();
            }
        }

        if (status !== currentStatus) {
            setCurrentStatus(status);
            
            // Clean up flags if authentication fails
            if (status === "unauthenticated" && currentStatus === "loading") {
                sessionStorage.removeItem('searchFlow');
                sessionStorage.removeItem('directLogin');
                sessionStorage.removeItem('pendingArtistSpotifyId');
                sessionStorage.removeItem('pendingArtistName');
            }
        }
    }, [status, currentStatus, isConnected, address, session, openConnectModal, router, toast]);

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
                            ref={ref}
                            className={`hover:bg-gray-200 transition-colors duration-300 text-black px-0 w-12 h-12 bg-pastypink ${buttonStyles}`} 
                            id="login-btn" 
                            size="lg" 
                            onClick={() => {
                                if (openConnectModal) {
                                    // If we're not in the search flow, set a flag to indicate this is a direct login
                                    if (!sessionStorage.getItem('searchFlow')) {
                                        sessionStorage.setItem('directLogin', 'true');
                                    }
                                    openConnectModal();
                                }
                            }}
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
                            ref={ref}
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
});

Login.displayName = 'Login';

export default Login;

