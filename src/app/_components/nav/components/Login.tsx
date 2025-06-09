"use client"
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Button } from "@/components/ui/button";
import { useEffect, useState, useCallback, forwardRef, useRef } from 'react';
import { useSession, signOut } from "next-auth/react";
import { Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from "@/hooks/use-toast";
import { useAccount, useDisconnect, useConfig } from 'wagmi';
import { useConnectModal, useAccountModal, useChainModal } from '@rainbow-me/rainbowkit';
import { addArtist } from "@/app/actions/addArtist";

// Add type for the SearchBar ref
interface SearchBarRef {
    clearLoading: () => void;
}

interface LoginProps {
    buttonChildren?: React.ReactNode;
    buttonStyles: string;
    isplaceholder?: boolean;
    searchBarRef?: React.RefObject<SearchBarRef>;
}

// Component for wallet-enabled mode
const WalletLogin = forwardRef<HTMLButtonElement, LoginProps>(({ buttonChildren, buttonStyles = "bg-gray-100", isplaceholder = false, searchBarRef }, ref) => {
    const router = useRouter();
    const { toast } = useToast();
    const { data: session, status } = useSession();
    const [currentStatus, setCurrentStatus] = useState(status);
    const shouldPromptRef = useRef(false);

    const { isConnected, address } = useAccount();
    const { disconnect } = useDisconnect();
    const config = useConfig();
    const { openConnectModal } = useConnectModal();

    // Handle disconnection and cleanup
    const handleDisconnect = useCallback(async () => {
        try {
            console.log("[Login] Disconnecting wallet and cleaning up session");
            
            // Save any existing search flow data
            const searchSpotifyId = sessionStorage.getItem('pendingArtistSpotifyId');
            const searchArtistName = sessionStorage.getItem('pendingArtistName');
            const searchFlow = sessionStorage.getItem('searchFlow');
            
            // First clear all session and local storage
            sessionStorage.clear();
            
            // Restore search flow data if it existed
            if (searchFlow) {
                sessionStorage.setItem('pendingArtistSpotifyId', searchSpotifyId ?? '');
                sessionStorage.setItem('pendingArtistName', searchArtistName ?? '');
                sessionStorage.setItem('searchFlow', searchFlow);
                // Add a flag to indicate this was a manual disconnect
                sessionStorage.setItem('manualDisconnect', 'true');
            }
            
            // Clear only wallet-related items
            localStorage.removeItem('wagmi.wallet');
            localStorage.removeItem('wagmi.connected');
            localStorage.removeItem('wagmi.injected.connected');
            localStorage.removeItem('wagmi.store');
            localStorage.removeItem('wagmi.cache');
            localStorage.removeItem('siwe.session');
            localStorage.removeItem('wagmi.siwe.message');
            localStorage.removeItem('wagmi.siwe.signature');
            
            // Reset prompt flag
            shouldPromptRef.current = false;
            
            // Then disconnect and sign out
            if (disconnect) {
                disconnect();
                // Small delay to ensure disconnect completes
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            await signOut({ redirect: false });
            
            // Force a page reload to clear any lingering state
            window.location.reload();
            
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
            pendingArtist: sessionStorage.getItem('pendingArtistName'),
            shouldPrompt: shouldPromptRef.current,
            manualDisconnect: sessionStorage.getItem('manualDisconnect'),
            loginInitiator: sessionStorage.getItem('loginInitiator')
        });

        // Handle successful authentication
        if (isConnected && session) {
            // Reset prompt flag and manual disconnect flag
            shouldPromptRef.current = false;
            sessionStorage.removeItem('manualDisconnect');
            sessionStorage.removeItem('loginInitiator');
            
            // Clear loading state if it was set
            if (searchBarRef?.current) {
                searchBarRef.current.clearLoading();
            }
            
            if (sessionStorage.getItem('searchFlow')) {
                // Show success toast
                toast({
                    title: "Connected!",
                    description: "You can now add artists to your collection.",
                });
            }
        }

        // Handle login initiation
        if (!session && status === "unauthenticated" && !isConnected) {
            const loginInitiator = sessionStorage.getItem('loginInitiator');
            const isSearchFlow = sessionStorage.getItem('searchFlow');
            
            if (shouldPromptRef.current || (loginInitiator === 'searchBar' && isSearchFlow)) {
                console.log("[Login] Initiating connection for:", loginInitiator);
                
                // Clear any existing SIWE data to force a new message
                sessionStorage.removeItem('siwe-nonce');
                localStorage.removeItem('siwe.session');
                localStorage.removeItem('wagmi.siwe.message');
                localStorage.removeItem('wagmi.siwe.signature');
                
                // Clear CSRF token to force new nonce
                document.cookie = 'next-auth.csrf-token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT';
                
                if (openConnectModal) {
                    openConnectModal();
                }
            }
        }

        if (status !== currentStatus) {
            setCurrentStatus(status);
            
            // Clean up flags if authentication fails
            if (status === "unauthenticated" && currentStatus === "loading") {
                // Don't clear session storage if this was a manual disconnect
                if (!sessionStorage.getItem('manualDisconnect')) {
                    sessionStorage.clear();
                    localStorage.removeItem('wagmi.wallet');
                    localStorage.removeItem('wagmi.connected');
                    localStorage.removeItem('wagmi.injected.connected');
                    localStorage.removeItem('wagmi.store');
                    localStorage.removeItem('wagmi.cache');
                }
                shouldPromptRef.current = false;
            }
        }
    }, [status, currentStatus, isConnected, address, session, openConnectModal, router, toast, searchBarRef]);

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
                const ready = mounted && config;

                if (!ready) {
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
                                    // Set flag to indicate explicit user action
                                    shouldPromptRef.current = true;
                                    sessionStorage.setItem('directLogin', 'true');
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

WalletLogin.displayName = 'WalletLogin';

// Component for non-wallet mode
const NoWalletLogin = forwardRef<HTMLButtonElement, LoginProps>((props, ref) => {
    // Return a placeholder div with the same dimensions as the wallet button
    return (
        <div className="w-12 h-12" />
    );
});

NoWalletLogin.displayName = 'NoWalletLogin';

// Main component that decides which version to render
const Login = forwardRef<HTMLButtonElement, LoginProps>((props, ref) => {
    const isWalletRequired = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT !== 'true';
    
    if (!isWalletRequired) {
        return <NoWalletLogin {...props} ref={ref} />;
    }

    return <WalletLogin {...props} ref={ref} />;
});

Login.displayName = 'Login';

export default Login;

