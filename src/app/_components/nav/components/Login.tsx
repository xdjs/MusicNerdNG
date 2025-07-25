// @ts-nocheck
"use client"
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useEffect, useState, useCallback, forwardRef, useRef } from 'react';
import { useSession, signOut } from "next-auth/react";
import { Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from "@/hooks/use-toast";
import { useAccount, useDisconnect, useConfig } from 'wagmi';
import { useConnectModal, useAccountModal, useChainModal } from '@rainbow-me/rainbowkit';
import { addArtist } from "@/app/actions/addArtist";
import Link from 'next/link';

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
const WalletLogin = forwardRef<HTMLButtonElement, LoginProps>(
    ({ buttonChildren, buttonStyles = "bg-gray-100", isplaceholder = false, searchBarRef }, ref): JSX.Element => {
    const router = useRouter();
    const { toast } = useToast();
    const { data: session, status } = useSession();
    const [currentStatus, setCurrentStatus] = useState(status);
    const [hasPendingUGC, setHasPendingUGC] = useState(false);
    const shouldPromptRef = useRef(false);

    const { isConnected, address } = useAccount();
    const { disconnect } = useDisconnect();
    const config = useConfig();
    const { openConnectModal } = useConnectModal();

    useEffect(() => {
        console.debug("[Login] State changed:", {
            authFrom: currentStatus,
            authTo: status,
            isConnected,
            address,
            sessionUser: session?.user,
            isSearchFlow: sessionStorage.getItem('searchFlow'),
            pendingArtist: sessionStorage.getItem('pendingArtistName'),
            shouldPrompt: shouldPromptRef.current
        });

        // Handle successful authentication
        if (isConnected && session) {
            // Reset prompt flag
            shouldPromptRef.current = false;
            
            // Clear loading state if it was set
            if (searchBarRef?.current) {
                searchBarRef.current.clearLoading();
            }
            
            if (sessionStorage.getItem('searchFlow')) {
                // Show success toast once
                toast({
                    title: "Connected!",
                    description: "You can now add artists to your collection.",
                });
                // Clear flags so it won't fire again on navigation
                sessionStorage.removeItem('searchFlow');
                sessionStorage.removeItem('pendingArtistSpotifyId');
                sessionStorage.removeItem('pendingArtistName');
                sessionStorage.removeItem('searchFlowPrompted');
            }
            return;
        }

        // Handle initial login or reconnection
        if (!isConnected && !session && status === "unauthenticated") {
            const loginInitiator = sessionStorage.getItem('loginInitiator');
            const isSearchFlow = sessionStorage.getItem('searchFlow');
            const isSearchFlowPrompted = sessionStorage.getItem('searchFlowPrompted');
            
            if (
                (shouldPromptRef.current || (loginInitiator === 'searchBar' && isSearchFlow)) &&
                !isSearchFlowPrompted
            ) {
                console.debug("[Login] Starting initial connection");
                if (openConnectModal) {
                    openConnectModal();
                }
                // Ensure we don't auto-prompt again during the same logged-out session
                shouldPromptRef.current = false;
                sessionStorage.setItem('searchFlowPrompted', 'true');
                sessionStorage.removeItem('loginInitiator');
            }
        }

        // Handle status changes
        if (status !== currentStatus) {
            setCurrentStatus(status);
            
            // Clean up flags if authentication fails
            if (status === "unauthenticated" && currentStatus === "loading") {
                sessionStorage.clear();
                shouldPromptRef.current = false;
            }
        }
    }, [status, currentStatus, isConnected, address, session, openConnectModal, router, toast, searchBarRef]);

    // Reusable fetcher for pending UGC count
    const fetchPendingUGC = useCallback(async () => {
        if (session?.user?.isAdmin) {
            try {
                const res = await fetch('/api/pendingUGCCount');
                if (res.ok) {
                    const data = await res.json();
                    setHasPendingUGC(data.count > 0);
                }
            } catch (e) {
                console.error('[Login] Error fetching pending UGC count', e);
            }
        } else {
            setHasPendingUGC(false);
        }
    }, [session]);

    // Fetch pending UGC count for admin users
    useEffect(() => {
        fetchPendingUGC();
    }, [fetchPendingUGC]);

    // Listen for "pendingUGCUpdated" events to update the red dot immediately
    useEffect(() => {
        window.addEventListener('pendingUGCUpdated', fetchPendingUGC);
        return () => window.removeEventListener('pendingUGCUpdated', fetchPendingUGC);
    }, [fetchPendingUGC]);

    // Handle disconnection and cleanup
    const handleDisconnect = useCallback(async () => {
        try {
            console.debug("[Login] Disconnecting wallet and cleaning up session");
            
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
            
            // Reset prompt flag and manual disconnect flag, also clear flow flags
            shouldPromptRef.current = false;
            sessionStorage.removeItem('manualDisconnect');
            sessionStorage.removeItem('searchFlowPrompted');
            sessionStorage.removeItem('loginInitiator');
            
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
        console.debug("[Login] State changed:", {
            authFrom: currentStatus,
            authTo: status,
            isConnected,
            address,
            sessionUser: session?.user,
            isSearchFlow: sessionStorage.getItem('searchFlow'),
            pendingArtist: sessionStorage.getItem('pendingArtistName'),
            shouldPrompt: shouldPromptRef.current,
            manualDisconnect: sessionStorage.getItem('manualDisconnect')
        });

        // Handle successful authentication
        if (isConnected && session) {
            // Reset prompt flag and manual disconnect flag
            shouldPromptRef.current = false;
            sessionStorage.removeItem('manualDisconnect');
            
            // Clear loading state if it was set
            if (searchBarRef?.current) {
                searchBarRef.current.clearLoading();
            }
            
            if (sessionStorage.getItem('searchFlow')) {
                toast({
                    title: "Connected!",
                    description: "You can now add artists to your collection.",
                });
                sessionStorage.removeItem('searchFlow');
                sessionStorage.removeItem('pendingArtistSpotifyId');
                sessionStorage.removeItem('pendingArtistName');
                sessionStorage.removeItem('searchFlowPrompted');
            }
        }

        // Only handle reconnection if explicitly triggered
        if (shouldPromptRef.current && !session && status === "unauthenticated" && !isConnected) {
                            console.debug("[Login] Detected explicit login action, initiating connection");
            if (openConnectModal) {
                openConnectModal();
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

    // --- Synchronize auth session with wallet connection ---
    // When the user disconnects their wallet via RainbowKit's account modal,
    // wagmi sets `isConnected` to false but `next-auth` may still report them as
    // authenticated.  We need to clear the session so the UI reflects the real
    // state.
    //
    // Immediately signing the user out can cause issues on page load because
    // wagmi might briefly report `isConnected === false` while it is still
    // restoring the connection.  To avoid accidental log-outs we add a small
    // grace period.  If the wallet is still disconnected after the delay we
    // sign the user out silently.
    useEffect(() => {
        let timeoutId: NodeJS.Timeout | null = null;
        if (!isConnected && status === "authenticated") {
            timeoutId = setTimeout(() => {
                // Re-check to ensure we didn't reconnect during the delay
                if (!isConnected) {
                    signOut({ redirect: false });
                }
            }, 1500);
        }
        return () => {
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, [isConnected, status]);

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
                    // User is not logged in – show dropdown with Log In option.
                    return (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                        <Button 
                            ref={ref}
                            id="login-btn" 
                            title="View leaderboard" 
                            size="lg" 
                                    type="button"
                                    className={`hover:bg-gray-200 transition-colors duration-300 text-black px-0 w-12 h-12 bg-pastypink ${buttonStyles}`}
                                    onClick={() => {
                                        if (openConnectModal) {
                                            shouldPromptRef.current = true;
                                            sessionStorage.setItem('directLogin', 'true');
                                            openConnectModal();
                                        }
                                    }}
                                >
                                    {buttonChildren ?? <Wallet color="white" />}
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => router.push('/leaderboard')}>Leaderboard</DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => router.push('/profile')}>User Profile</DropdownMenuItem>
                                <DropdownMenuItem
                                    onSelect={() => {
                                if (openConnectModal) {
                                    shouldPromptRef.current = true;
                                    sessionStorage.setItem('directLogin', 'true');
                                    openConnectModal();
                                }
                            }}
                                >
                                    Log In
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    );
                }

                // User is authenticated – show dropdown with profile and logout options.
                return (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                        <Button 
                            ref={ref}
                            title="View leaderboard" 
                            type="button" 
                                size="lg"
                            className="relative bg-pastypink hover:bg-pastypink/80 transition-colors duration-300 w-12 h-12 p-0 flex items-center justify-center" 
                        >
                            {isplaceholder ? (
                                <img className="max-h-6" src="/spinner.svg" alt="Loading..." />
                            ) : (
                                <span className="text-xl">🥳</span>
                            )}
                            {hasPendingUGC && (
                                <span className="absolute top-0 right-0 h-3 w-3 rounded-full bg-red-600 border-2 border-white" />
                            )}
                        </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => router.push('/leaderboard')}>Leaderboard</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => router.push('/profile')}>User Profile</DropdownMenuItem>
                            {session?.user?.isAdmin && (
                                <DropdownMenuItem onSelect={() => router.push('/admin')} className="flex items-center gap-2">
                                    <span>Admin Panel</span>
                                    {hasPendingUGC && (
                                        <span className="inline-block h-2 w-2 rounded-full bg-red-600" />
                                    )}
                                </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                                onSelect={(e) => {
                                    e.preventDefault();
                                    handleDisconnect();
                                }}
                            >
                                Log Out
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                );
            }}
        </ConnectButton.Custom>
    );
});

WalletLogin.displayName = 'WalletLogin';

// Component for non-wallet mode
const isLocalEnvironment = typeof window === 'undefined'
    ? process.env.NODE_ENV !== 'production'
    : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const NoWalletLogin: React.FC<LoginProps> = ({ buttonStyles }) => {
    // Keep original footprint (w-12 h-12). When local, render admin link inside.
    return (
        <div className="w-12 h-12 flex items-center justify-center">
            {isLocalEnvironment && (
                <Link
                    href="/admin"
                    title="Admin panel"
                    aria-label="Admin panel"
                    className={`flex items-center justify-center w-full h-full bg-pastypink hover:bg-gray-200 transition-colors duration-300 text-black ${buttonStyles}`}
                >
                    ⚙️
                </Link>
            )}
        </div>
    );
};

// Main component that decides which version to render
const Login = forwardRef<HTMLButtonElement, LoginProps>((props, ref): JSX.Element => {
    // Walletless mode is only permitted when NODE_ENV !== 'production'
    const walletlessEnabled = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT === 'true' && process.env.NODE_ENV !== 'production';

    if (walletlessEnabled) {
        return <NoWalletLogin {...props} />;
    }

    return <WalletLogin {...props} ref={ref} />;
});

Login.displayName = 'Login';

export default Login;

