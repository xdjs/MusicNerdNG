"use client"
import { useEffect, useState, useRef, ReactNode, Suspense, forwardRef, useImperativeHandle } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useDebounce } from 'use-debounce';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { Artist } from '@/server/db/DbTypes';
import { Input } from '@/components/ui/input';
import { Search, ExternalLink } from 'lucide-react';
import Image from 'next/image';
import { addArtist } from "@/app/actions/addArtist";
import { useSession, signOut } from "next-auth/react";
import { useToast } from "@/hooks/use-toast";
import LoadingPage from "@/app/_components/LoadingPage";
import { useAccount, useDisconnect } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import Login from "./Login";
import { Wallet } from 'lucide-react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Button } from "@/components/ui/button";
import type { Session } from "next-auth";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 0, // Set to 0 to always refetch
            gcTime: 0, // Disable caching (formerly cacheTime)
            refetchOnWindowFocus: false,
        },
    },
})

// Defines the structure of a Spotify artist's image
interface SpotifyArtistImage {
  url: string;
  height: number;
  width: number;
}

// Extends the base Artist type to include Spotify-specific fields
interface SearchResult extends Artist {
  isSpotifyOnly?: boolean;
  images?: SpotifyArtistImage[];
}

// Add type for the ref
interface SearchBarRef {
    clearLoading: () => void;
}

interface SearchBarProps {
    isTopSide?: boolean;
}

// Component for wallet-enabled mode
const WalletSearchBar = forwardRef(
  (props: SearchBarProps, ref: React.Ref<SearchBarRef>) => {
    const { isTopSide = false } = props;
    const router = useRouter();
    const pathname = usePathname();
    const [query, setQuery] = useState('');
    const [showResults, setShowResults] = useState(false);
    const [debouncedQuery] = useDebounce(query, 200);
    const searchParams = useSearchParams();
    const resultsContainer = useRef(null);
    const search = searchParams.get('search');
    const blurTimeoutRef = useRef<NodeJS.Timeout>();
    const [isAddingArtist, setIsAddingArtist] = useState(false);
    const [isAddingNew, setIsAddingNew] = useState(false);
    const { data: session, status } = useSession();
    const { toast } = useToast();
    const loginRef = useRef<HTMLButtonElement>(null);
    const shouldPromptRef = useRef(false);
    // Used to delay opening RainbowKit until next-auth status is settled
    const loginRetryRef = useRef<NodeJS.Timeout | null>(null);
    // Ref to the wrapper element to calculate available space
    const wrapperRef = useRef<HTMLDivElement>(null);
    // Track whether the results dropdown should open up or down
    const [dropDirection, setDropDirection] = useState<'up' | 'down'>('down');

    // Wagmi hooks are safe to use here
    const { openConnectModal } = useConnectModal() ?? {};
    const { isConnected: walletConnected } = useAccount() ?? { isConnected: false };
    const { disconnect } = useDisconnect() ?? { disconnect: undefined };

    // Expose clearLoading function to parent components
    useImperativeHandle(ref, () => ({
        clearLoading: () => {
            setIsAddingArtist(false);
            setIsAddingNew(false);
        }
    }));

    // Add cleanup effect for loading states
    useEffect(() => {
        return () => {
            setIsAddingArtist(false);
            setIsAddingNew(false);
            if (loginRetryRef.current) {
                clearTimeout(loginRetryRef.current);
            }
        };
    }, []);

    // Add effect to clear loading states after navigation
    useEffect(() => {
        setIsAddingArtist(false);
        setIsAddingNew(false);
    }, [pathname]);

    // Determine the best direction for the dropdown based on viewport space
    const updateDropDirection = () => {
        if (!wrapperRef.current) return;
        const rect = wrapperRef.current.getBoundingClientRect();
        const spaceAbove = rect.top;
        const requiredSpace = 260; // approx height for 4 results

        if (isTopSide) {
            // Prefer opening upwards on the homepage but fall back if not enough space
            if (spaceAbove >= requiredSpace) {
                setDropDirection('up');
            } else {
                setDropDirection('down');
            }
        } else {
            setDropDirection('down');
        }
    };

    // Re-evaluate dropdown direction when the window resizes
    useEffect(() => {
        window.addEventListener('resize', updateDropDirection);
        return () => window.removeEventListener('resize', updateDropDirection);
    }, [isTopSide]);

    // Enable mouse-wheel scrolling over the whole search bar wrapper
    const handleWheelScroll = (e: React.WheelEvent<HTMLDivElement>) => {
        if (resultsContainer.current) {
            (resultsContainer.current as HTMLDivElement).scrollTop += e.deltaY;
        }
    };

    const handleNavigate = async (result: SearchResult) => {
        setQuery(result.name ?? "");
        setShowResults(false);

        if (result.isSpotifyOnly) {
            if (status === "loading") {
                if (!loginRetryRef.current) {
                    loginRetryRef.current = setTimeout(() => {
                        loginRetryRef.current = null;
                        handleNavigate(result);
                    }, 250);
                }
                return;
            }

            // If not connected or no session, handle login first
            if (!walletConnected || !session) {
                // Set up search flow flags before initiating login
                sessionStorage.setItem('searchFlow', 'true');
                sessionStorage.setItem('pendingArtistSpotifyId', result.spotify ?? '');
                sessionStorage.setItem('pendingArtistName', result.name ?? '');
                sessionStorage.setItem('loginInitiator', 'searchBar');
                
                // Set the shouldPrompt flag in the Login component
                if (loginRef.current) {
                    shouldPromptRef.current = true;
                }
                
                // Small delay to ensure state is set
                setTimeout(() => {
                    if (openConnectModal) {
                        openConnectModal();
                    }
                }, 100);
                return;
            }

            // Only try to add the artist if we have a session
            try {
                setIsAddingArtist(true);
                setIsAddingNew(true);
                const addResult = await addArtist(result.spotify ?? "");
                
                if ((addResult.status === "success" || addResult.status === "exists") && addResult.artistId) {
                    const url = `/artist/${addResult.artistId}`;
                    try {
                        router.prefetch(url);
                        await router.push(url);
                    } catch (error) {
                        console.error("[SearchBar] Navigation error:", error);
                        setIsAddingArtist(false);
                        setIsAddingNew(false);
                    }
                } else {
                    toast({
                        variant: "destructive",
                        title: "Error",
                        description: addResult.message || "Failed to add artist"
                    });
                    setIsAddingArtist(false);
                    setIsAddingNew(false);
                }
            } catch (error) {
                console.error("[SearchBar] Error adding artist:", error);
                if (error instanceof Error && error.message.includes('Not authenticated')) {
                    // Set up search flow flags before initiating login
                    sessionStorage.setItem('searchFlow', 'true');
                    sessionStorage.setItem('pendingArtistSpotifyId', result.spotify ?? '');
                    sessionStorage.setItem('pendingArtistName', result.name ?? '');
                    sessionStorage.setItem('loginInitiator', 'searchBar');
                    
                    // Set the shouldPrompt flag in the Login component
                    if (loginRef.current) {
                        shouldPromptRef.current = true;
                    }
                    
                    // Small delay to ensure state is set
                    setTimeout(() => {
                        if (openConnectModal) {
                            openConnectModal();
                        }
                    }, 100);
                } else {
                    toast({
                        variant: "destructive",
                        title: "Error",
                        description: "Failed to add artist - please try again"
                    });
                }
                setIsAddingArtist(false);
                setIsAddingNew(false);
            }
        } else if (result.id) {
            // For existing artists, show loading screen and navigate
            setIsAddingArtist(true);
            setIsAddingNew(false);
            try {
                const url = `/artist/${result.id}`;
                router.prefetch(url);
                await router.push(url);
            } catch (error) {
                console.error("[SearchBar] Error navigating to artist:", error);
                setIsAddingArtist(false);
                setIsAddingNew(false);
                toast({
                    variant: "destructive",
                    title: "Error",
                    description: "Failed to navigate to artist page"
                });
            }
        }
    };

    // Fetches combined search results from both database and Spotify
    const { data, isLoading } = useQuery({
        queryKey: ['combinedSearchResults', debouncedQuery],
        queryFn: async () => {
            if (!debouncedQuery) return null;
            const response = await fetch('/api/searchArtists', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query: debouncedQuery }),
            });
            if (!response.ok) {
                throw new Error('Search request failed');
            }
            const data = await response.json();
            return data.results;
        },
        enabled: debouncedQuery.length > 0,
        retry: 2,
    });

    // Updates the search query and triggers the search
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
        const value = e.target.value;
        setQuery(value);
    };

    // Handle blur with a slight delay to allow click events to process
    const handleBlur = () => {
        blurTimeoutRef.current = setTimeout(() => {
            setShowResults(false);
        }, 200);
    };

    // Modify handleFocus to compute direction before showing results
    const handleFocus = () => {
        if (blurTimeoutRef.current) {
            clearTimeout(blurTimeoutRef.current);
        }
        updateDropDirection();
        setShowResults(true);
    };

    // Add hidden Login component for search flow
    return (
        <>
            {isAddingArtist && <LoadingPage message={isAddingNew ? "Adding artist..." : "Loading..."} />}
            <div ref={wrapperRef} onWheel={handleWheelScroll} className="relative w-full max-w-[400px] z-40 text-black">
                <div className="p-3 bg-gray-100 rounded-lg flex items-center gap-2 h-12 hover:bg-gray-200 transition-colors duration-300">
                    <Search size={24} strokeWidth={2.5} />
                    <Input
                        type="text"
                        placeholder="Search artists..."
                        value={query}
                        onChange={handleInputChange}
                        onFocus={handleFocus}
                        onBlur={handleBlur}
                        className="bg-transparent border-none focus:outline-none w-full"
                    />
                </div>
                {/* Search results dropdown */}
                {showResults && (
                    <div ref={resultsContainer} className={`absolute w-full ${dropDirection === 'up' ? 'bottom-full mb-2' : 'mt-2'} bg-white rounded-lg shadow-lg overflow-y-auto max-h-64`}>
                        {isLoading ? (
                            <Spinner />
                        ) : (debouncedQuery && (!data || data.length === 0)) ? (
                            <div className="flex justify-center items-center p-3 font-medium">
                                <p>Artist not found!</p>
                            </div>
                        ) : data ? (
                            <div>
                                {data.map((result: SearchResult) => {
                                    const spotifyImage = result.images?.[0]?.url;
                                    return (
                                        <div
                                            key={result.isSpotifyOnly ? result.spotify : result.id}
                                            className="p-3 hover:bg-gray-100 cursor-pointer flex items-center gap-3"
                                            onClick={() => handleNavigate(result)}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={`flex items-center justify-center ${result.isSpotifyOnly ? 'h-10 w-10' : ''}`}>
                                                    <img 
                                                        src={spotifyImage || "/default_pfp_pink.png"} 
                                                        alt={result.name ?? "Artist"} 
                                                        className={`object-cover rounded-full ${result.isSpotifyOnly ? 'w-8 h-8' : 'w-10 h-10'}`}
                                                    />
                                                </div>
                                                <div className="flex-grow">
                                                    <div className={`font-medium ${result.isSpotifyOnly ? 'text-sm' : 'text-base'} ${
                                                        !result.isSpotifyOnly && 
                                                        !(result.bandcamp || result.youtubechannel || result.instagram || result.x || result.facebook || result.tiktok) 
                                                        ? 'flex items-center h-full' : '-mb-0.5'
                                                    }`}>
                                                        {result.name}
                                                    </div>
                                                    {result.isSpotifyOnly ? (
                                                        <div className="text-xs text-gray-500 flex items-center gap-1">
                                                            <span className="cursor-pointer hover:text-gray-600 hover:underline">Add to MusicNerd</span>
                                                            <span className="text-gray-300">|</span>
                                                            <div 
                                                                className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer hover:text-gray-600"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    window.open(`https://open.spotify.com/artist/${result.spotify}`, '_blank');
                                                                }}
                                                            >
                                                                <span className="hover:underline">View on Spotify</span>
                                                                <ExternalLink size={12} className="text-gray-500" />
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="flex flex-col items-start gap-1">
                                                            <div className="flex flex-col w-[140px]">
                                                                {(result.bandcamp || result.youtubechannel || result.instagram || result.x || result.facebook || result.tiktok) && (
                                                                    <>
                                                                        <div className="border-0 h-[1px] my-1 bg-gradient-to-r from-gray-400 to-transparent" style={{ height: '1px' }}></div>
                                                                        <div className="flex items-center gap-2">
                                                                            {result.bandcamp && (
                                                                                <img src="/siteIcons/bandcamp_icon.svg" alt="Bandcamp" className="w-3.5 h-3.5 opacity-70" />
                                                                            )}
                                                                            {result.youtubechannel && (
                                                                                <img src="/siteIcons/youtube_icon.svg" alt="YouTube" className="w-3.5 h-3.5 opacity-70" />
                                                                            )}
                                                                            {result.instagram && (
                                                                                <img src="/siteIcons/instagram-svgrepo-com.svg" alt="Instagram" className="w-3.5 h-3.5 opacity-70" />
                                                                            )}
                                                                            {result.x && (
                                                                                <img src="/siteIcons/x_icon.svg" alt="X" className="w-3.5 h-3.5 opacity-70" />
                                                                            )}
                                                                            {result.facebook && (
                                                                                <img src="/siteIcons/facebook_icon.svg" alt="Facebook" className="w-3.5 h-3.5 opacity-70" />
                                                                            )}
                                                                            {result.tiktok && (
                                                                                <img src="/siteIcons/tiktok_icon.svg" alt="TikTok" className="w-3.5 h-3.5 opacity-70" />
                                                                            )}
                                                                        </div>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : null}
                    </div>
                )}
            </div>
        </>
    );
  }
) as React.ForwardRefExoticComponent<
  SearchBarProps & React.RefAttributes<SearchBarRef>
>;

WalletSearchBar.displayName = 'WalletSearchBar';

// Component for non-wallet mode
const NoWalletSearchBar = forwardRef(
  (props: SearchBarProps, ref: React.Ref<SearchBarRef>) => {
    const { isTopSide = false } = props;
    const router = useRouter();
    const pathname = usePathname();
    const [query, setQuery] = useState('');
    const [showResults, setShowResults] = useState(false);
    const [debouncedQuery] = useDebounce(query, 200);
    const searchParams = useSearchParams();
    const resultsContainer = useRef(null);
    const search = searchParams.get('search');
    const blurTimeoutRef = useRef<NodeJS.Timeout>();
    const [isAddingArtist, setIsAddingArtist] = useState(false);
    const [isAddingNew, setIsAddingNew] = useState(false);
    const { data: session, status } = useSession();
    const { toast } = useToast();
    
    // Wagmi hooks are safe to use here
    const { openConnectModal: connectModal } = useConnectModal() ?? {};
    const { isConnected: walletConnected } = useAccount() ?? { isConnected: false };
    const { disconnect } = useDisconnect() ?? { disconnect: undefined };

    // Expose clearLoading function to parent components
    useImperativeHandle(ref, () => ({
        clearLoading: () => {
            setIsAddingArtist(false);
            setIsAddingNew(false);
        }
    }));

    // Add cleanup effect for loading states
    useEffect(() => {
        // Clear loading states when component unmounts
        return () => {
            setIsAddingArtist(false);
            setIsAddingNew(false);
        };
    }, []);

    // Add effect to handle authentication state changes
    useEffect(() => {
        console.log("[SearchBar] Auth state changed:", {
            status,
            walletConnected,
            session: !!session,
            searchFlow: sessionStorage.getItem('searchFlow'),
            pendingArtist: sessionStorage.getItem('pendingArtistName')
        });

        if (
            sessionStorage.getItem('searchFlow') &&
            !session &&
            status === "unauthenticated" &&
            !walletConnected &&
            !sessionStorage.getItem('searchFlowPrompted')
        ) {
            console.log("[SearchBar] Search flow needs authentication, initiating connection");

            // Mark that we've already prompted once for this flow
            sessionStorage.setItem('searchFlowPrompted', 'true');

            // Only proceed if this wasn't a manual disconnect
            if (!sessionStorage.getItem('manualDisconnect')) {
                // Clear CSRF token cookie first
                document.cookie = 'next-auth.csrf-token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT';

                // Clear all SIWE-related data
                sessionStorage.removeItem('siwe-nonce');
                localStorage.removeItem('siwe.session');
                localStorage.removeItem('wagmi.siwe.message');
                localStorage.removeItem('wagmi.siwe.signature');

                // Clear all wagmi-related data
                localStorage.removeItem('wagmi.wallet');
                localStorage.removeItem('wagmi.connected');
                localStorage.removeItem('wagmi.injected.connected');
                localStorage.removeItem('wagmi.store');
                localStorage.removeItem('wagmi.cache');

                // Small delay to ensure cleanup is complete
                setTimeout(() => {
                    if (connectModal) {
                        connectModal();
                    }
                }, 100);
            }
        }

        // Clear the prompt flag once the user becomes authenticated (or the flow is aborted)
        if (session && sessionStorage.getItem('searchFlowPrompted')) {
            sessionStorage.removeItem('searchFlowPrompted');
        }
    }, [status, walletConnected, session, connectModal]);

    // Add effect to clear loading states after navigation
    useEffect(() => {
        // Only clear loading states if we're not in the middle of authentication
        if (!sessionStorage.getItem('searchFlow')) {
            setIsAddingArtist(false);
            setIsAddingNew(false);
        }
    }, [pathname]);

    const handleNavigate = async (result: SearchResult) => {
        setQuery(result.name ?? "");
        setShowResults(false);

        if (result.isSpotifyOnly) {
            if (status === "loading") {
                console.log("[SearchBar] Auth status is loading, waiting...");
                return;
            }

            // In non-wallet mode, we can directly try to add the artist
            try {
                console.log("[SearchBar] Adding Spotify artist:", result.name);
                setIsAddingArtist(true);
                setIsAddingNew(true);
                const addResult = await addArtist(result.spotify ?? "");
                console.log("[SearchBar] Add artist result:", addResult);
                
                if ((addResult.status === "success" || addResult.status === "exists") && addResult.artistId) {
                    // Navigate using push
                    const url = `/artist/${addResult.artistId}`;
                    try {
                        router.prefetch(url);
                        await router.push(url);
                    } catch (error) {
                        console.error("[SearchBar] Navigation error:", error);
                        setIsAddingArtist(false);
                        setIsAddingNew(false);
                        toast({
                            variant: "destructive",
                            title: "Error",
                            description: "Failed to navigate to artist page"
                        });
                    }
                } else {
                    toast({
                        variant: "destructive",
                        title: "Error",
                        description: addResult.message || "Failed to add artist"
                    });
                    setIsAddingArtist(false);
                    setIsAddingNew(false);
                }
            } catch (error) {
                console.error("[SearchBar] Error adding artist:", error);
                toast({
                    variant: "destructive",
                    title: "Error",
                    description: "Failed to add artist - please try again"
                });
                setIsAddingArtist(false);
                setIsAddingNew(false);
            }
        } else if (result.id) {
            // For existing artists, show loading screen and navigate
            setIsAddingArtist(true);
            setIsAddingNew(false);
            try {
                const url = `/artist/${result.id}`;
                router.prefetch(url);
                await router.push(url);
            } catch (error) {
                console.error("[SearchBar] Error navigating to artist:", error);
                setIsAddingArtist(false);
                setIsAddingNew(false);
                toast({
                    variant: "destructive",
                    title: "Error",
                    description: "Failed to navigate to artist page"
                });
            }
        }
    };

    // Fetches combined search results from both database and Spotify
    const { data, isLoading } = useQuery({
        queryKey: ['combinedSearchResults', debouncedQuery],
        queryFn: async () => {
            if (!debouncedQuery) return null;
            const response = await fetch('/api/searchArtists', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query: debouncedQuery }),
            });
            if (!response.ok) {
                throw new Error('Search request failed');
            }
            const data = await response.json();
            return data.results;
        },
        enabled: debouncedQuery.length > 0,
        retry: 2,
    });

    // Updates the search query and triggers the search
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
        const value = e.target.value;
        setQuery(value);
    };

    // Handle blur with a slight delay to allow click events to process
    const handleBlur = () => {
        blurTimeoutRef.current = setTimeout(() => {
            setShowResults(false);
        }, 200);
    };

    // Modify handleFocus to compute direction before showing results
    const handleFocus = () => {
        if (blurTimeoutRef.current) {
            clearTimeout(blurTimeoutRef.current);
        }
        updateDropDirection();
        setShowResults(true);
    };

    const handleLogout = async () => {
        try {
            console.log("[SearchBar] Signing out");
            
            // Set flag to indicate this was a manual disconnect
            sessionStorage.setItem('manualDisconnect', 'true');
            
            // Clear CSRF token cookie first
            document.cookie = 'next-auth.csrf-token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT';
            
            // Clear all session data
            sessionStorage.clear();
            localStorage.removeItem('siwe.session');
            localStorage.removeItem('wagmi.siwe.message');
            localStorage.removeItem('wagmi.siwe.signature');
            sessionStorage.removeItem('siwe-nonce');
            
            // Clear all wagmi-related data
            localStorage.removeItem('wagmi.wallet');
            localStorage.removeItem('wagmi.connected');
            localStorage.removeItem('wagmi.injected.connected');
            localStorage.removeItem('wagmi.store');
            localStorage.removeItem('wagmi.cache');
            
            // First disconnect the wallet
            if (disconnect) {
                disconnect();
                // Small delay to ensure disconnect completes
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            // Then sign out of NextAuth
            await signOut({ 
                redirect: false,
                callbackUrl: window.location.origin
            });
            
            // Wait longer for session cleanup
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Force a page reload to clear any lingering state
            window.location.reload();
            
            toast({
                title: "Signed out",
                description: "You have been signed out successfully"
            });
        } catch (error) {
            console.error("[SearchBar] Error during sign out:", error);
            toast({
                variant: "destructive",
                title: "Error",
                description: "Failed to sign out properly"
            });
            
            // Force a page reload even if there was an error
            window.location.reload();
        }
    };

    // Ref to the wrapper element to calculate available space for dropdown
    const wrapperRef = useRef<HTMLDivElement>(null);
    // Track dropdown direction (up or down)
    const [dropDirection, setDropDirection] = useState<'up' | 'down'>('down');

    // Function to compute and set the dropdown direction
    const updateDropDirection = () => {
        if (!wrapperRef.current) return;
        const rect = wrapperRef.current.getBoundingClientRect();
        const spaceAbove = rect.top;
        const requiredSpace = 260; // approx height for 4 results

        if (isTopSide) {
            if (spaceAbove >= requiredSpace) {
                setDropDirection('up');
            } else {
                setDropDirection('down');
            }
        } else {
            setDropDirection('down');
        }
    };

    // Re-calculate direction on window resize
    useEffect(() => {
        window.addEventListener('resize', updateDropDirection);
        return () => window.removeEventListener('resize', updateDropDirection);
    }, [isTopSide]);

    // Scroll handler so users can scroll results while hovering over the search bar
    const handleWheelScroll = (e: React.WheelEvent<HTMLDivElement>) => {
        if (resultsContainer.current) {
            (resultsContainer.current as HTMLDivElement).scrollTop += e.deltaY;
        }
    };

    // Add hidden Login component for search flow
    return (
        <>
            {isAddingArtist && <LoadingPage message={isAddingNew ? "Adding artist..." : "Loading..."} />}
            <div ref={wrapperRef} onWheel={handleWheelScroll} className="relative w-full max-w-[400px] z-40 text-black">
                <div className="p-3 bg-gray-100 rounded-lg flex items-center gap-2 h-12 hover:bg-gray-200 transition-colors duration-300">
                    <Search size={24} strokeWidth={2.5} />
                    <Input
                        type="text"
                        placeholder="Search artists..."
                        value={query}
                        onChange={handleInputChange}
                        onFocus={handleFocus}
                        onBlur={handleBlur}
                        className="bg-transparent border-none focus:outline-none w-full"
                    />
                </div>
                {/* Search results dropdown */}
                {showResults && (
                    <div ref={resultsContainer} className={`absolute w-full ${dropDirection === 'up' ? 'bottom-full mb-2' : 'mt-2'} bg-white rounded-lg shadow-lg overflow-y-auto max-h-64`}>
                        {isLoading ? (
                            <Spinner />
                        ) : (debouncedQuery && (!data || data.length === 0)) ? (
                            <div className="flex justify-center items-center p-3 font-medium">
                                <p>Artist not found!</p>
                            </div>
                        ) : data ? (
                            <div>
                                {data.map((result: SearchResult) => {
                                    const spotifyImage = result.images?.[0]?.url;
                                    return (
                                        <div
                                            key={result.isSpotifyOnly ? result.spotify : result.id}
                                            className="p-3 hover:bg-gray-100 cursor-pointer flex items-center gap-3"
                                            onClick={() => handleNavigate(result)}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={`flex items-center justify-center ${result.isSpotifyOnly ? 'h-10 w-10' : ''}`}>
                                                    <img 
                                                        src={spotifyImage || "/default_pfp_pink.png"} 
                                                        alt={result.name ?? "Artist"} 
                                                        className={`object-cover rounded-full ${result.isSpotifyOnly ? 'w-8 h-8' : 'w-10 h-10'}`}
                                                    />
                                                </div>
                                                <div className="flex-grow">
                                                    <div className={`font-medium ${result.isSpotifyOnly ? 'text-sm' : 'text-base'} ${
                                                        !result.isSpotifyOnly && 
                                                        !(result.bandcamp || result.youtubechannel || result.instagram || result.x || result.facebook || result.tiktok) 
                                                        ? 'flex items-center h-full' : '-mb-0.5'
                                                    }`}>
                                                        {result.name}
                                                    </div>
                                                    {result.isSpotifyOnly ? (
                                                        <div className="text-xs text-gray-500 flex items-center gap-1">
                                                            <span className="cursor-pointer hover:text-gray-600 hover:underline">Add to MusicNerd</span>
                                                            <span className="text-gray-300">|</span>
                                                            <div 
                                                                className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer hover:text-gray-600"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    window.open(`https://open.spotify.com/artist/${result.spotify}`, '_blank');
                                                                }}
                                                            >
                                                                <span className="hover:underline">View on Spotify</span>
                                                                <ExternalLink size={12} className="text-gray-500" />
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="flex flex-col items-start gap-1">
                                                            <div className="flex flex-col w-[140px]">
                                                                {(result.bandcamp || result.youtubechannel || result.instagram || result.x || result.facebook || result.tiktok) && (
                                                                    <>
                                                                        <div className="border-0 h-[1px] my-1 bg-gradient-to-r from-gray-400 to-transparent" style={{ height: '1px' }}></div>
                                                                        <div className="flex items-center gap-2">
                                                                            {result.bandcamp && (
                                                                                <img src="/siteIcons/bandcamp_icon.svg" alt="Bandcamp" className="w-3.5 h-3.5 opacity-70" />
                                                                            )}
                                                                            {result.youtubechannel && (
                                                                                <img src="/siteIcons/youtube_icon.svg" alt="YouTube" className="w-3.5 h-3.5 opacity-70" />
                                                                            )}
                                                                            {result.instagram && (
                                                                                <img src="/siteIcons/instagram-svgrepo-com.svg" alt="Instagram" className="w-3.5 h-3.5 opacity-70" />
                                                                            )}
                                                                            {result.x && (
                                                                                <img src="/siteIcons/x_icon.svg" alt="X" className="w-3.5 h-3.5 opacity-70" />
                                                                            )}
                                                                            {result.facebook && (
                                                                                <img src="/siteIcons/facebook_icon.svg" alt="Facebook" className="w-3.5 h-3.5 opacity-70" />
                                                                            )}
                                                                            {result.tiktok && (
                                                                                <img src="/siteIcons/tiktok_icon.svg" alt="TikTok" className="w-3.5 h-3.5 opacity-70" />
                                                                            )}
                                                                        </div>
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : null}
                    </div>
                )}
            </div>
        </>
    );
  }
) as React.ForwardRefExoticComponent<
  SearchBarProps & React.RefAttributes<SearchBarRef>
>;

NoWalletSearchBar.displayName = 'NoWalletSearchBar';

// Main SearchBar component that decides which version to render
const SearchBar = forwardRef(
  (props: SearchBarProps, ref: React.Ref<SearchBarRef>) => {
    const isWalletRequired = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT !== 'true';

    if (!isWalletRequired) {
        return <NoWalletSearchBar {...props} ref={ref} />;
    }

    return <WalletSearchBar {...props} ref={ref} />;
  }
) as React.ForwardRefExoticComponent<
  SearchBarProps & React.RefAttributes<SearchBarRef>
>;

SearchBar.displayName = 'SearchBar';

export default function SearchBarWrapper({isTopSide = false}: {isTopSide?: boolean}) {
    const searchBarRef = useRef<SearchBarRef>(null);
    
    return (
        <QueryClientProvider client={queryClient}>
            <SearchBar ref={searchBarRef} isTopSide={isTopSide} />
        </QueryClientProvider>
    );
}

export function Skeleton() {
    return (
        <div role="status" className='px-2 py-2'>
            <svg aria-hidden="true" className="w-5 h-5 text-gray-200 animate-spin dark:text-gray-600 fill-blue-600" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor" />
                <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill" />
            </svg>
            <span className="sr-only">Loading...</span>
        </div>
    )
}

export function Spinner() {
    return (
        <div className="flex justify-center items-center">
            <img className="h-10" src="/spinner.svg" alt="spinner" />
        </div>
    )
}
function SocialIcons({ result }: { result: SearchResult }) {
    const showIcons = !result.isSpotifyOnly;
    
    if (!showIcons) return null;
    
    const icons = [];
    
    if (result.bandcamp) {
        icons.push(
            <img key="bandcamp" src="/siteIcons/bandcamp_icon.svg" alt="Bandcamp" className="w-3.5 h-3.5 opacity-70" />
        );
    }
    
    if (result.youtubechannel) {
        icons.push(
            <img key="youtube" src="/siteIcons/youtube_icon.svg" alt="YouTube" className="w-3.5 h-3.5 opacity-70" />
        );
    }
    
    if (result.instagram) {
        icons.push(
            <img key="instagram" src="/siteIcons/instagram-svgrepo-com.svg" alt="Instagram" className="w-3.5 h-3.5 opacity-70" />
        );
    }
    
    if (icons.length === 0) return null;
    
    return (
        <div className="flex items-center gap-2 mt-0.5">
            {icons}
        </div>
    );
}

// Renders the search results list with proper handling for both database and Spotify results
// Params:
//      results: Array of combined search results from database and Spotify
//      search: Current search query string
//      setQuery: Function to update the search query
// Returns:
//      JSX.Element - The rendered search results list
function SearchResults({
    results,
    search,
    setQuery,
    setShowResults,
    onNavigate,
}: {
    results: SearchResult[] | undefined,
    search: string,
    setQuery: (query: string) => void,
    setShowResults: (show: boolean) => void,
    onNavigate: (result: SearchResult) => void,
}
) {
    if(!results || results.length === 0) {
        return (
            <div className="flex justify-center items-center p-3 font-medium">
                <p>Artist not found!</p>
            </div>
        )
    }

    return (
        <>
            {results.map(result => {
                const spotifyImage = result.images?.[0]?.url;
                return (
                    <div key={result.isSpotifyOnly ? result.spotify : result.id}>
                        <div
                            className={`block px-4 ${result.isSpotifyOnly ? 'py-1.5' : 'py-2'} hover:bg-gray-200 cursor-pointer rounded-lg`}
                            onMouseDown={(e) => {
                                e.preventDefault(); // Prevent blur
                                onNavigate(result);
                            }}
                        >
                            <div className="flex items-center gap-3">
                                <div className={`flex items-center justify-center ${result.isSpotifyOnly ? 'h-10 w-10' : ''}`}>
                                    <img 
                                        src={spotifyImage || "/default_pfp_pink.png"} 
                                        alt={result.name ?? "Artist"} 
                                        className={`object-cover rounded-full ${result.isSpotifyOnly ? 'w-8 h-8' : 'w-10 h-10'}`}
                                    />
                                </div>
                                <div className="flex-grow">
                                    <div className={`font-medium ${result.isSpotifyOnly ? 'text-sm' : 'text-base'} ${
                                        !result.isSpotifyOnly && 
                                        !(result.bandcamp || result.youtubechannel || result.instagram || result.x || result.facebook || result.tiktok) 
                                        ? 'flex items-center h-full' : '-mb-0.5'
                                    }`}>
                                        {result.name}
                                    </div>
                                    {result.isSpotifyOnly ? (
                                        <div className="text-xs text-gray-500 flex items-center gap-1">
                                            <span className="cursor-pointer hover:text-gray-600 hover:underline">Add to MusicNerd</span>
                                            <span className="text-gray-300">|</span>
                                            <div 
                                                className="flex items-center gap-1 text-xs text-gray-500 cursor-pointer hover:text-gray-600"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    window.open(`https://open.spotify.com/artist/${result.spotify}`, '_blank');
                                                }}
                                            >
                                                <span className="hover:underline">View on Spotify</span>
                                                <ExternalLink size={12} className="text-gray-500" />
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-start gap-1">
                                            <div className="flex flex-col w-[140px]">
                                                {(result.bandcamp || result.youtubechannel || result.instagram || result.x || result.facebook || result.tiktok) && (
                                                    <>
                                                        <div className="border-0 h-[1px] my-1 bg-gradient-to-r from-gray-400 to-transparent" style={{ height: '1px' }}></div>
                                                        <div className="flex items-center gap-2">
                                                            {result.bandcamp && (
                                                                <img src="/siteIcons/bandcamp_icon.svg" alt="Bandcamp" className="w-3.5 h-3.5 opacity-70" />
                                                            )}
                                                            {result.youtubechannel && (
                                                                <img src="/siteIcons/youtube_icon.svg" alt="YouTube" className="w-3.5 h-3.5 opacity-70" />
                                                            )}
                                                            {result.instagram && (
                                                                <img src="/siteIcons/instagram-svgrepo-com.svg" alt="Instagram" className="w-3.5 h-3.5 opacity-70" />
                                                            )}
                                                            {result.x && (
                                                                <img src="/siteIcons/x_icon.svg" alt="X" className="w-3.5 h-3.5 opacity-70" />
                                                            )}
                                                            {result.facebook && (
                                                                <img src="/siteIcons/facebook_icon.svg" alt="Facebook" className="w-3.5 h-3.5 opacity-70" />
                                                            )}
                                                            {result.tiktok && (
                                                                <img src="/siteIcons/tiktok_icon.svg" alt="TikTok" className="w-3.5 h-3.5 opacity-70" />
                                                            )}
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )
            })}
        </>
    )
}

