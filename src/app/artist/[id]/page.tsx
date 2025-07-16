import { getArtistById, getAllLinks } from "@/server/utils/queries/artistQueries";
import { getUserById } from "@/server/utils/queries/userQueries";
import { getSpotifyImage, getSpotifyHeaders, getNumberOfSpotifyReleases } from "@/server/utils/externalApiQueries";
import { AspectRatio } from "@radix-ui/react-aspect-ratio";
import ArtistLinks from "@/app/_components/ArtistLinks";
import { getArtistDetailsText } from "@/server/utils/services";
import Link from "next/link";
import { getServerAuthSession } from "@/server/auth";
import { notFound } from "next/navigation";
import { EditModeProvider } from "@/app/_components/EditModeContext";
import EditModeToggle from "@/app/_components/EditModeToggle";
import BlurbSection from "./_components/BlurbSection";
import AddArtistData from "@/app/artist/[id]/_components/AddArtistData";
import FunFactsMobile from "./_components/FunFactsMobile";
import FunFactsDesktop from "./_components/FunFactsDesktop";

type ArtistProfileProps = {
    params: { id: string };
    searchParams: { [key: string]: string | undefined };
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
                    <div className="space-y-6 mt-8 md:mt-8">
                        {/* Grid layout for Check out and Support sections */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {/* Check out section */}
                            <div className="space-y-6">
                                <div className="flex flex-col md:flex-row md:items-center md:justify-between">
                                    <strong className="text-black text-2xl">
                                        Check out {artist?.name} on <span className="whitespace-nowrap">other media platforms</span>!
                                    </strong>
                                    <div className="mt-4 md:mt-0 md:ml-4">
                                        <AddArtistData 
                                            label="Add links" 
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
                                <strong className="text-black text-2xl">
                                    Support {artist?.name}
                                </strong>
                                <div className="space-y-4">
                                    {(artist) &&
                                        <ArtistLinks isMonetized={true} artist={artist} spotifyImg={spotifyImg.artistImage} session={session} availableLinks={urlMapList} isOpenOnLoad={false} />
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
                </div>
                {/* Insert Fun Facts section for mobile only */}
                <FunFactsMobile artistId={artist.id} />
            </div>
            </EditModeProvider>
        </>
    );
}