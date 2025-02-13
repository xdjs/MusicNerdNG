
import { getArtistById, getAllLinks } from "@/server/utils/queriesTS";
import { getSpotifyImage, getArtistWiki, getSpotifyHeaders, getNumberOfSpotifyReleases } from "@/server/utils/externalApiQueries";
import { AspectRatio } from "@radix-ui/react-aspect-ratio";
import { Spotify } from 'react-spotify-embed';
import ArtistLinks from "@/app/_components/ArtistLinks";
import { getArtistDetailsText } from "@/server/utils/services";
import Link from "next/link";
import AddArtistData from "./_components/AddArtistData";
import { getServerAuthSession } from "@/server/auth";
import { notFound } from "next/navigation";

type ArtistProfileProps = {
    params: { id: string };
    searchParams: { [key: string]: string | undefined };
}

export default async function ArtistProfile({ params, searchParams }: ArtistProfileProps) {
    const session = await getServerAuthSession();
    const artist = await getArtistById(params.id);
    if (!artist) {
        return notFound();
    }
    const { opADM } = searchParams;
    const headers = await getSpotifyHeaders();

    const [spotifyImg, numReleases, wiki, allLinks] = await Promise.all([
        getSpotifyImage(artist.spotify ?? "", undefined, headers),
        getNumberOfSpotifyReleases(artist.spotify ?? "", headers),
        getArtistWiki(artist.wikipedia ?? ""),
        getAllLinks()
    ]);

    return (
        <>
            <div className="gap-4 px-4 flex flex-col md:flex-row">
                {/* Artist Info Box */}
                <div className="bg-white rounded-lg md:w-2/3 gap-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 px-10 pt-10 pb-0 md:pb-10 w-full">
                        {/* Left Column: Image and Song */}
                        {(spotifyImg.artistImage) &&
                            <div className="flex flex-col items-center md:items-end">

                                <AspectRatio ratio={1 / 1} className="flex items-center place-content-center bg-muted rounded-md overflow-hidden w-full mb-4">
                                    {(spotifyImg) && <img src={spotifyImg.artistImage} alt="Artist Image" className="object-cover w-full h-full" />}
                                </AspectRatio>
                                {artist.spotify &&
                                    <div className="w-full">
                                        <div className="justify-center overflow-hidden rounded-xl">
                                            <div style={{
                                                height: 'calc(100% + 32px)',
                                                width: 'calc(100% + 72px)',
                                                marginLeft: '-72px',
                                                marginTop: '-32px',
                                            }}>
                                                <Spotify wide link={`https://open.spotify.com/artist/${artist.spotify}`} />
                                            </div>
                                        </div>
                                    </div>
                                }
                            </div>
                        }
                        {/* Right Column: Name and Description */}
                        <div className="flex flex-col justify-start md:col-span-2 pl-0 md:pl-4">
                            <div className="mb-2 flex justify-between items-center">
                                <strong className="text-black text-2xl mr-2">
                                    {artist.name}
                                </strong>
                                <AddArtistData availableLinks={allLinks} artist={artist} spotifyImg={spotifyImg.artistImage} session={session} isOpenOnLoad={opADM === "1"} />
                            </div>
                            <div className="text-black pt-0 mb-4">
                                {(artist) && getArtistDetailsText(artist, numReleases)}
                            </div>
                            {(artist.wikipedia) &&
                                <>
                                    <p className="text-black mb-4">
                                        {wiki?.blurb}
                                    </p>
                                    <Link href={`${wiki?.link}`} className="text-black underline mb-4">
                                        {"WIKIPEDIA"}
                                    </Link>
                                </>
                            }
                        </div>
                    </div>
                    <div className="ml-10 pb-4 pr-10">
                        <strong className="text-black text-2xl">
                            Check out {artist?.name} on other media platforms!
                        </strong>
                        <div className="pt-4">
                            {(artist) &&
                                <ArtistLinks isMonetized={false} artist={artist} spotifyImg={spotifyImg.artistImage} session={session} availableLinks={allLinks} isOpenOnLoad={false} />
                            }
                        </div>
                    </div>
                </div>
                {/* Support Artist Box - Fixed Sidebar */}
                <div className="bg-white px-6 rounded-lg shadow-lg flex flex-col md:w-1/3">
                    <div className="top-0 sticky">
                        <div className="pl-4 pt-10 pb-4 text-black text-2xl">
                            <strong>
                                Support {artist?.name}
                            </strong>
                        </div>
                        <div className="pl-4">
                            {(artist) &&
                                <ArtistLinks isMonetized={true} artist={artist} spotifyImg={spotifyImg.artistImage} session={session} availableLinks={allLinks} isOpenOnLoad={false} />
                            }
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}