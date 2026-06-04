"use client"
import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useDebounce } from 'use-debounce';
import { useSearchParams } from 'next/navigation'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { Artist } from '@/server/db/DbTypes';
import { Input } from '@/components/ui/input';
import { Search, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useSession } from "next-auth/react";
import { addArtist } from "@/app/actions/addArtist";
import { isDevMode } from "@/lib/dev-mode";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 0,
            gcTime: 0,
            refetchOnWindowFocus: false,
        },
    },
})

interface SearchResult extends Artist {
  isExternalOnly?: boolean;
  imageUrl?: string | null;
  platformId?: string;
  platform?: string;
  profileUrl?: string;
}

interface SearchBarProps {
    isTopSide?: boolean;
}

const PENDING_ADD_KEY = 'pendingAddArtistPlatformId';
const PENDING_ADD_PLATFORM_KEY = 'pendingAddArtistPlatform';
const PENDING_ADD_TS_KEY = 'pendingAddArtistTimestamp';
const PENDING_ADD_TTL_MS = 5 * 60 * 1000; // 5 minutes

function SearchBarInner({ isTopSide = false }: SearchBarProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [query, setQuery] = useState('');
    const [showResults, setShowResults] = useState(false);
    const [debouncedQuery] = useDebounce(query, 200);
    const searchParams = useSearchParams();
    const resultsContainer = useRef(null);
    const search = searchParams.get('search');
    const blurTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
    const { data: session } = useSession();
    const [addingPlatformId, setAddingPlatformId] = useState<string | null>(null);

    const handleAddArtist = useCallback(async (platformId: string, platform: string = 'deezer') => {
        try {
            setAddingPlatformId(platformId);
            const addResult = await addArtist(platformId, platform as 'deezer' | 'spotify');

            if ((addResult.status === "success" || addResult.status === "exists") && addResult.artistId) {
                setShowResults(false);
                setQuery('');
                router.push(`/artist/${addResult.artistId}`);
            } else {
                toast({
                    variant: "destructive",
                    title: "Error",
                    description: addResult.message || "Failed to add artist"
                });
            }
        } catch (error) {
            console.error("[SearchBar] Error adding artist:", error);
            toast({
                variant: "destructive",
                title: "Error",
                description: "Failed to add artist - please try again"
            });
        } finally {
            setAddingPlatformId(null);
        }
    }, [router, toast]);

    // After login + page reload, complete the pending add-artist flow
    useEffect(() => {
        if (!session) return;
        const pendingId = sessionStorage.getItem(PENDING_ADD_KEY);
        if (!pendingId) return;

        const pendingPlatform = sessionStorage.getItem(PENDING_ADD_PLATFORM_KEY) || 'deezer';
        const timestamp = Number(sessionStorage.getItem(PENDING_ADD_TS_KEY) || '0');
        sessionStorage.removeItem(PENDING_ADD_KEY);
        sessionStorage.removeItem(PENDING_ADD_PLATFORM_KEY);
        sessionStorage.removeItem(PENDING_ADD_TS_KEY);

        // Discard stale pending adds (e.g. user dismissed login, logged in later)
        if (Date.now() - timestamp > PENDING_ADD_TTL_MS) return;

        handleAddArtist(pendingId, pendingPlatform);
    }, [session, handleAddArtist]);

    useEffect(() => {
        setQuery(search ?? '');
    }, [search]);

    const { data: results = [], isLoading } = useQuery<SearchResult[]>({
        queryKey: ['searchArtists', debouncedQuery],
        queryFn: async () => {
            if (!debouncedQuery || debouncedQuery.trim() === '') return [];

            const response = await fetch('/api/searchArtists', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query: debouncedQuery }),
            });
            if (!response.ok) {
                throw new Error('Search failed');
            }
            const data = await response.json();
            return data.results;
        },
        enabled: debouncedQuery.trim() !== '',
    });

    useEffect(() => {
        if (debouncedQuery && debouncedQuery.trim() !== '' && results.length > 0) {
            setShowResults(true);
        }
    }, [debouncedQuery, results]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setQuery(value);

        if (value.trim() === '') {
            setShowResults(false);
        }
    };

    const handleBlur = () => {
        blurTimeoutRef.current = setTimeout(() => {
            setShowResults(false);
        }, 200);
    };

    const handleFocus = () => {
        if (blurTimeoutRef.current) {
            clearTimeout(blurTimeoutRef.current);
        }
        if (query.trim() !== '' && results.length > 0) {
            setShowResults(true);
        }
    };

    useEffect(() => {
        return () => {
            if (blurTimeoutRef.current) {
                clearTimeout(blurTimeoutRef.current);
            }
        };
    }, []);

    const handleResultClick = async (result: SearchResult) => {
        if (result.isExternalOnly) {
            if (!result.platformId) return;

            if (!session && !isDevMode) {
                try {
                    sessionStorage.setItem(PENDING_ADD_KEY, result.platformId);
                    sessionStorage.setItem(PENDING_ADD_PLATFORM_KEY, result.platform || 'deezer');
                    sessionStorage.setItem(PENDING_ADD_TS_KEY, String(Date.now()));
                    const loginBtn = document.getElementById('login-btn');
                    loginBtn?.click();
                } catch (e) {
                    console.error("[SearchBar] Login trigger failed:", e);
                }
                return;
            }

            await handleAddArtist(result.platformId, result.platform || 'deezer');
            return;
        }

        setShowResults(false);
        setQuery('');

        if (result.id) {
            router.push(`/artist/${result.id}`);
        }
    };

    const getPlatformLabel = (platform?: string) => {
        if (!platform) return 'Deezer';
        return platform.charAt(0).toUpperCase() + platform.slice(1);
    };

    return (
        <div className="relative w-full max-w-[400px]">
            <div className="relative">
                <Input
                    type="text"
                    placeholder="Search for an artist..."
                    value={query}
                    onChange={handleInputChange}
                    onBlur={handleBlur}
                    onFocus={handleFocus}
                    className="pl-10"
                />
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            </div>

            {showResults && results.length > 0 && (
                <div
                    ref={resultsContainer}
                    className="absolute w-full mt-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg max-h-96 overflow-y-auto z-50"
                >
                    {results.map((result) => {
                        const resultImage = result.imageUrl;
                        const hasSocialLinks = result.bandcamp || result.youtube || result.youtubechannel || result.instagram || result.x || result.facebook || result.tiktok;
                        const isThisAdding = result.isExternalOnly && addingPlatformId === result.platformId;

                        return (
                            <button
                                key={result.isExternalOnly ? `ext-${result.platformId}` : result.id}
                                disabled={isThisAdding}
                                onClick={() => handleResultClick(result)}
                                className={`w-full p-3 flex items-center gap-3 text-left disabled:opacity-50 ${
                                    result.isExternalOnly
                                        ? 'hover:bg-gray-50 dark:hover:bg-gray-700'
                                        : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                                }`}
                            >
                                <div className="flex items-center justify-center w-10 h-10">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={resultImage || "/default_pfp_pink.png"}
                                        alt={result.name ?? "Artist"}
                                        className={`object-cover rounded-full ${result.isExternalOnly ? 'w-8 h-8' : 'w-10 h-10'}`}
                                    />
                                </div>
                                <div className="flex-1">
                                    <div className={`font-medium ${result.isExternalOnly ? 'text-sm text-gray-500 dark:text-gray-400' : 'text-base text-gray-900 dark:text-white'}`}>
                                        {result.name}
                                    </div>
                                    {result.isExternalOnly && result.platformId ? (
                                        <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                                            <span className="hover:text-gray-600 hover:underline">
                                                {isThisAdding ? 'Adding...' : 'Add to MusicNerd'}
                                            </span>
                                            <span className="text-pink-400">|</span>
                                            <a
                                                href={result.profileUrl || '#'}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={(e) => e.stopPropagation()}
                                                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-600 hover:underline"
                                            >
                                                <span>View on {getPlatformLabel(result.platform)}</span>
                                                <ExternalLink size={12} className="text-gray-500" />
                                            </a>
                                        </div>
                                    ) : hasSocialLinks && (
                                        <div className="flex items-center gap-2 mt-1">
                                            {result.bandcamp && (
                                                /* eslint-disable-next-line @next/next/no-img-element */
                                                <img src="/siteIcons/bandcamp_icon.svg" alt="Bandcamp" className="w-3.5 h-3.5 opacity-70" />
                                            )}
                                            {(result.youtube || result.youtubechannel) && (
                                                /* eslint-disable-next-line @next/next/no-img-element */
                                                <img src="/siteIcons/youtube_icon.svg" alt="YouTube" className="w-3.5 h-3.5 opacity-70" />
                                            )}
                                            {result.instagram && (
                                                /* eslint-disable-next-line @next/next/no-img-element */
                                                <img src="/siteIcons/instagram-svgrepo-com.svg" alt="Instagram" className="w-3.5 h-3.5 opacity-70" />
                                            )}
                                            {result.x && (
                                                /* eslint-disable-next-line @next/next/no-img-element */
                                                <img src="/siteIcons/x_icon.svg" alt="X" className="w-3.5 h-3.5 opacity-70" />
                                            )}
                                            {result.facebook && (
                                                /* eslint-disable-next-line @next/next/no-img-element */
                                                <img src="/siteIcons/facebook_icon.svg" alt="Facebook" className="w-3.5 h-3.5 opacity-70" />
                                            )}
                                            {result.tiktok && (
                                                /* eslint-disable-next-line @next/next/no-img-element */
                                                <img src="/siteIcons/tiktok_icon.svg" alt="TikTok" className="w-3.5 h-3.5 opacity-70" />
                                            )}
                                        </div>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}

            {isLoading && (
                <div className="absolute w-full mt-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 text-center z-50">
                    <div className="text-gray-600 dark:text-gray-400">Searching...</div>
                </div>
            )}
        </div>
    );
}

export default function SearchBar(props: SearchBarProps) {
    return (
        <QueryClientProvider client={queryClient}>
            <SearchBarInner {...props} />
        </QueryClientProvider>
    );
}
