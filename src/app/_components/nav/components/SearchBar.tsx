"use client"
import { useEffect, useState, useRef, ReactNode, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { useDebounce } from 'use-debounce';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { Artist } from '@/server/db/DbTypes';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import Image from 'next/image';
import { addArtist } from "@/app/actions/addArtist";
import { useSession } from "next-auth/react";
import { useToast } from "@/hooks/use-toast";
import LoadingPage from "@/app/_components/LoadingPage";
import { useAccount, useConnect } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';

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
  supercollector?: string | null;
}

export default function SearchBarWrapper({isTopSide = false}: {isTopSide?: boolean}) {
    return (
        <QueryClientProvider client={queryClient}>
            <SearchBar isTopSide={isTopSide} />
        </QueryClientProvider>
    )
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
            <img key="instagram" src="/siteIcons/instagram_icon.svg" alt="Instagram" className="w-3.5 h-3.5 opacity-70" />
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
    setIsAddingArtist,
}: {
    results: SearchResult[] | undefined,
    search: string,
    setQuery: (query: string) => void,
    setShowResults: (show: boolean) => void,
    setIsAddingArtist: (isAdding: boolean) => void,
}
) {
    const router = useRouter();
    const { data: session, status } = useSession();
    const [isAdding, setIsAdding] = useState<string | null>(null);
    const { toast } = useToast();
    const { openConnectModal } = useConnectModal();
    const { isConnected } = useAccount();

    async function navigateToResult(result: SearchResult) {
        setQuery(result.name ?? "");
        setShowResults(false);

        if (result.isSpotifyOnly) {
            if (status === "loading") {
                console.log("[SearchBar] Auth status is loading, waiting...");
                return;
            }

            // If not connected or no session, handle login first
            if (!isConnected || !session) {
                console.log("[SearchBar] No session/connection, storing artist data:", {
                    name: result.name,
                    spotify: result.spotify,
                    images: result.images,
                    isSpotifyOnly: true
                });

                // Clear any existing pending data first
                sessionStorage.removeItem('pendingArtistAdd');
                
                // Store the artist info in sessionStorage before redirecting to login
                const pendingData = {
                    spotify: result.spotify,
                    name: result.name,
                    images: result.images,
                    isSpotifyOnly: true,
                    timestamp: Date.now()
                };
                sessionStorage.setItem('pendingArtistAdd', JSON.stringify(pendingData));

                // Add a loading state while we wait for the connect modal
                setIsAddingArtist(true);

                try {
                    if (openConnectModal) {
                        console.log("[SearchBar] Opening connect modal");
                        await openConnectModal();
                    } else {
                        console.warn("[SearchBar] Connect modal not available");
                    }
                } catch (error) {
                    console.error("[SearchBar] Error during connection flow:", error);
                    toast({
                        variant: "destructive",
                        title: "Error",
                        description: "Failed to connect wallet - please try again"
                    });
                } finally {
                    setIsAddingArtist(false);
                }
                return;
            }

            // Only try to add the artist if we have a session
            try {
                console.log("[SearchBar] User is logged in, adding Spotify artist:", result.name);
                setIsAdding(result.spotify ?? "");
                setIsAddingArtist(true);
                const addResult = await addArtist(result.spotify ?? "");
                console.log("[SearchBar] Add artist result:", addResult);
                
                if ((addResult.status === "success" || addResult.status === "exists") && addResult.artistId) {
                    await router.replace(`/artist/${addResult.artistId}`);
                } else {
                    setIsAddingArtist(false);
                    toast({
                        variant: "destructive",
                        title: "Error",
                        description: addResult.message || "Failed to add artist"
                    });
                }
            } catch (err) {
                console.error("[SearchBar] Error adding artist:", err);
                setIsAddingArtist(false);
                if (err instanceof Error && err.message.includes('Not authenticated')) {
                    console.log("[SearchBar] Session expired, storing artist data");
                    // Clear any existing pending data first
                    sessionStorage.removeItem('pendingArtistAdd');
                    
                    // Store the artist info in sessionStorage before redirecting to login
                    const pendingData = {
                        spotify: result.spotify,
                        name: result.name,
                        images: result.images,
                        isSpotifyOnly: true,
                        timestamp: Date.now()
                    };
                    sessionStorage.setItem('pendingArtistAdd', JSON.stringify(pendingData));

                    if (openConnectModal) {
                        openConnectModal();
                    }
                } else {
                    toast({
                        variant: "destructive",
                        title: "Error",
                        description: "Failed to add artist - please try again"
                    });
                }
            }
        } else {
            // For non-Spotify artists, just navigate to their page
            router.push(`/artist/${result.id}`);
        }
    }
    
    if(!results || results.length === 0) {
        return (
            <div className="flex justify-center items-center p-3 font-medium">
                <p>Artist not found!</p>
            </div>
        )
    }

    return (
        <>
            {[...results].map(result => {
                const spotifyImage = result.images?.[0]?.url;
                const isAddingThis = isAdding === result.spotify;
                return (
                    <div key={result.isSpotifyOnly ? result.spotify : result.id}>
                        <div
                            className={`block px-4 ${result.isSpotifyOnly ? 'py-1.5' : 'py-2'} hover:bg-gray-200 cursor-pointer rounded-lg ${isAddingThis ? 'opacity-50' : ''}`}
                            onMouseDown={(e) => {
                                e.preventDefault(); // Prevent blur
                                if (!isAddingThis) {
                                    navigateToResult(result);
                                }
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
                                        <div className="text-xs text-gray-500 flex items-center gap-2">
                                            {isAddingThis ? (
                                                <>
                                                    <img className="h-3" src="/spinner.svg" alt="Loading" />
                                                    <span>Adding...</span>
                                                </>
                                            ) : "Add to MusicNerd"}
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
                                                                <img src="/siteIcons/instagram_icon.svg" alt="Instagram" className="w-3.5 h-3.5 opacity-70" />
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

// Main search bar component that provides artist search functionality
// Params:
//      isTopSide: Boolean indicating if the search bar is at the top of the page
// Returns:
//      JSX.Element - The rendered search bar with results dropdown
const SearchBar = ({isTopSide}: {isTopSide: boolean}) => {
    const router = useRouter();
    const [query, setQuery] = useState('');
    const [showResults, setShowResults] = useState(false);
    const [debouncedQuery] = useDebounce(query, 200);
    const searchParams = useSearchParams();
    const resultsContainer = useRef(null);
    const search = searchParams.get('search');
    const blurTimeoutRef = useRef<NodeJS.Timeout>();
    const [isAddingArtist, setIsAddingArtist] = useState(false);
    const { data: session, status } = useSession();
    const { openConnectModal } = useConnectModal();
    const { isConnected } = useAccount();

    // Add effect to handle loading state cleanup after navigation
    useEffect(() => {
        return () => {
            // Cleanup loading state when component unmounts (during navigation)
            setIsAddingArtist(false);
        };
    }, []);

    // Handle blur with a slight delay to allow click events to process
    const handleBlur = () => {
        blurTimeoutRef.current = setTimeout(() => {
            setShowResults(false);
        }, 200);
    };

    // Clear the blur timeout if we focus back
    const handleFocus = () => {
        if (blurTimeoutRef.current) {
            clearTimeout(blurTimeoutRef.current);
        }
        setShowResults(true);
    };

    // Fetches combined search results from both database and Spotify
    // Uses react-query for caching and automatic request management
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

    return (
        <>
            {isAddingArtist && <LoadingPage message="Adding artist..." />}
            <div className="relative w-full max-w-[400px] z-40 text-black">
            <div className="p-3 bg-gray-100 rounded-lg flex items-center gap-2 h-12 hover:bg-gray-200 transition-colors duration-300">
                <Search size={24} strokeWidth={2.5} />
                <Input
                        onBlur={handleBlur}
                        onFocus={handleFocus}
                    type="text"
                    value={query}
                    onChange={handleInputChange}
                    className="w-full p-0 bg-transparent rounded-lg focus:outline-none text-lg"
                    placeholder="Search"
                />
            </div>
            {(showResults && query.length >= 1) && (
                    <div 
                        ref={resultsContainer} 
                        className={`absolute left-0 w-full mt-2 bg-white rounded-lg shadow-2xl max-h-60 overflow-y-auto pl-1 pr-0 py-1 ${isTopSide ? "bottom-14" : "top-12"}
                        scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-300 hover:scrollbar-thumb-gray-400`}
                        style={{ scrollbarGutter: 'stable' }}
                        onMouseDown={(e) => e.preventDefault()} // Prevent blur from hiding results during click
                    >
                        {isLoading ? <Spinner /> : <SearchResults results={data} search={search ?? ""} setQuery={setQuery} setShowResults={setShowResults} setIsAddingArtist={setIsAddingArtist} />}
                </div>
            )}
        </div>
        </>
    );
};
