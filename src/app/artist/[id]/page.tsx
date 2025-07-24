import { getArtistById, getAllLinks } from "@/server/utils/queries/artistQueries";
import { getUserById } from "@/server/utils/queries/userQueries";
import { getSpotifyImage, getSpotifyHeaders, getNumberOfSpotifyReleases } from "@/server/utils/queries/externalApiQueries";
import { AspectRatio } from "@radix-ui/react-aspect-ratio";
import ArtistLinks from "@/app/_components/ArtistLinks";
import { getArtistDetailsText } from "@/server/utils/services";
import { getServerAuthSession } from "@/server/auth";
import { notFound } from "next/navigation";
import { EditModeProvider } from "@/app/_components/EditModeContext";
import EditModeToggle from "@/app/_components/EditModeToggle";
import BlurbSection from "./_components/BlurbSection";
import AddArtistData from "@/app/artist/[id]/_components/AddArtistData";
import FunFactsMobile from "./_components/FunFactsMobile";
import FunFactsDesktop from "./_components/FunFactsDesktop";
import ArtistAutoRefresh from "./ArtistAutoRefresh";
import { Metadata } from "next";

type ArtistProfileProps = {
    params: { id: string };
    searchParams: { [key: string]: string | undefined };
}

/**
 * Helper function to get artist bio for metadata purposes
 * Uses cached bio if available, otherwise returns fallback text
 */
async function getArtistBioForMetadata(artistId: string): Promise<string> {
    try {
        // Short timeout for metadata generation (5 seconds max)
        const response = await Promise.race([
            fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/artistBio/${artistId}`),
            new Promise<never>((_, reject) => 
                setTimeout(() => reject(new Error('Bio fetch timeout')), 5000)
            )
        ]);

        if (response.ok) {
            const data = await response.json();
            return data.bio || '';
        }
    } catch (error) {
        console.error('Error fetching bio for metadata:', error);
    }
    
    // Return empty string if bio fetch fails
    return '';
}

/**
 * Truncate text to fit meta description limits (160 characters)
 */
function truncateForMetaDescription(text: string, maxLength: number = 160): string {
    if (text.length <= maxLength) return text;
    
    // Try to truncate at word boundary
    const truncated = text.substring(0, maxLength - 3);
    const lastSpace = truncated.lastIndexOf(' ');
    
    if (lastSpace > maxLength * 0.8) {
        return truncated.substring(0, lastSpace) + '...';
    }
    
    return truncated + '...';
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
    const artist = await getArtistById(params.id);
    
    if (!artist) {
        return {
            title: 'Artist Not Found - Music Nerd',
            description: 'The requested artist could not be found on Music Nerd.',
        };
    }

    // Fetch Spotify image for use in Open Graph meta tags
    const headers = await getSpotifyHeaders();
    const spotifyImg = await getSpotifyImage(artist.spotify ?? "", undefined, headers);

    // Fetch artist bio for meta description
    const artistBio = await getArtistBioForMetadata(params.id);
    
    // Create meta description
    let description: string;
    if (artistBio) {
        // Use bio content, truncated to 160 characters
        description = truncateForMetaDescription(artistBio);
    } else {
        // Fallback to generic description
        description = `Discover ${artist.name} on Music Nerd - social media links, music, and more.`;
    }

    return {
        title: `${artist.name} - Music Nerd`,
        description,
    };
}

export default async function ArtistProfile({ params, searchParams }: ArtistProfileProps) {
    const session = await getServerAuthSession();
    const walletlessEnabled = process.env.NEXT_PUBLIC_DISABLE_WALLET_REQUIREMENT === 'true' && process.env.NODE_ENV !== 'production';
    let canEdit = walletlessEnabled;
    if (session?.user?.id) {
        const user = await getUserById(session.user.id);
        if (user?.isWhiteListed || user?.isAdmin) {
            canEdit = true;
        }
    }
    const artist = await getArtistById(params.id);
    if (!artist) {
        return notFound();
    }
    const headers = await getSpotifyHeaders();

    const [spotifyImg, numReleases, urlMapList] = await Promise.all([
        getSpotifyImage(artist.spotify ?? "", undefined, headers),
        getNumberOfSpotifyReleases(artist.spotify ?? "", headers),
        getAllLinks(),
    ]);



    return (
        <>
            <EditModeProvider canEdit={canEdit}>
            <ArtistAutoRefresh />
            <div className="gap-4 px-4 flex flex-col md:flex-row max-w-[1000px] mx-auto">
                {/* Artist Info Box */}
                <div className="bg-white rounded-lg md:w-2/3 gap-y-4 shadow-2xl px-5 py-5 md:py-10 md:px-10 space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
                        {/* Left Column: Image and Song */}
                        <div className="flex flex-col items-center md:items-end">
                            <AspectRatio ratio={1 / 1} className="flex items-center place-content-center bg-muted rounded-md overflow-hidden w-full mb-4">
                                <img src={spotifyImg.artistImage || "/default_pfp_pink.png"} alt="Artist Image" className="object-cover w-full h-full" />
                            </AspectRatio>
                            {/* Add links button moved below to the "Check out" section */}
                        </div>
                        {/* Right Column: Name and Description */}
                        <div className="flex flex-col justify-start md:col-span-2 pl-0 md:pl-4">
                            <div className="mb-2 flex items-center justify-between">
                                <strong className="text-black text-2xl mr-2">
                                    {artist.name}
                                </strong>
                                {canEdit && <EditModeToggle className="ml-4" />}
                            </div>
                            <div className="text-black pt-0 mb-4">
                                {(artist) && getArtistDetailsText(artist, numReleases)}
                            </div>
                            <BlurbSection 
                                key={artist.bio ?? ""}
                                artistName={artist.name ?? ""}
                                artistId={artist.id}
                                />
                        </div>
                    </div>
                    <div className="space-y-4 mt-6 md:mt-6">
                        {/* Grid layout for Check out and Support sections */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {/* Check out section */}
                            <div className="space-y-6">
                                <div className="flex flex-row items-center justify-between">
                                    <strong className="text-black text-2xl">
                                        Social Media Links
                                    </strong>
                                    <div className="mt-2 md:mt-0 md:ml-2">
                                        <AddArtistData 
                                            artist={artist} 
                                            spotifyImg={spotifyImg.artistImage ?? ""} 
                                            availableLinks={urlMapList} 
                                            isOpenOnLoad={false} 
                                        />
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    {(artist) &&
                                        <ArtistLinks canEdit={canEdit} isMonetized={false} artist={artist} spotifyImg={spotifyImg.artistImage} session={session} availableLinks={urlMapList} isOpenOnLoad={false} showAddButton={false} />
                                    }
                                </div>
                            </div>

                            {/* Support section */}
                            <div className="space-y-6">
                                <div className="flex flex-row items-center justify-between">
                                    <strong className="text-black text-2xl">
                                        Support the Artist
                                    </strong>
                                    <div className="mt-2 md:mt-0 md:ml-2">
                                        <AddArtistData 
                                            artist={artist} 
                                            spotifyImg={spotifyImg.artistImage ?? ""} 
                                            availableLinks={urlMapList} 
                                            isOpenOnLoad={false} 
                                        />
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    {(artist) &&
                                        <ArtistLinks isMonetized={true} artist={artist} spotifyImg={spotifyImg.artistImage} session={session} availableLinks={urlMapList} isOpenOnLoad={false} canEdit={canEdit} />
                                    }
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                {/* Sidebar: Fun Facts (desktop) */}
                <div className="flex flex-col md:w-1/3 space-y-4">
                    {/* Fun Facts section - visible on md and up */}
                    <FunFactsDesktop artistId={artist.id} />
                    {/* Empty Collaborators box */}
                    <div className="hidden md:block bg-white rounded-lg shadow-2xl p-6 space-y-4 overflow-x-hidden">
                        <h2 className="text-2xl font-bold text-black">Grapevine</h2>
                        <div className="relative w-full h-[180px]">
                            <iframe
                                src={`${process.env.NEXT_PUBLIC_GRAPEVINE_URL}/${artist.id}`}
                                className="w-full h-full border-0 rounded-md pointer-events-none"
                                loading="lazy"
                            />
                            <a
                                href={`${process.env.NEXT_PUBLIC_GRAPEVINE_URL}/${artist.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="absolute inset-0 z-10"
                            >
                                <span className="sr-only">Open Grapevine</span>
                            </a>
                        </div>
                    </div>
                </div>
                {/* Insert Fun Facts section for mobile only */}
                <FunFactsMobile artistId={artist.id} />

                {/* Mobile-only Collaborators box displayed below Fun Facts */}
                <div className="block md:hidden bg-white rounded-lg shadow-2xl mt-4 p-6 space-y-4 overflow-x-hidden">
                    <h2 className="text-2xl font-bold text-black">Grapevine</h2>
                    <div className="relative w-full h-[180px]">
                        <iframe
                            src={`${process.env.NEXT_PUBLIC_GRAPEVINE_URL}/${artist.id}`}
                            className="w-full h-full border-0 rounded-md pointer-events-none"
                            loading="lazy"
                        />
                        <a
                            href={`${process.env.NEXT_PUBLIC_GRAPEVINE_URL}/${artist.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="absolute inset-0 z-10"
                        >
                            <span className="sr-only">Open Grapevine</span>
                        </a>
                    </div>
                </div>
            </div>
            </EditModeProvider>
        </>
    );
}