"use client"

import { AspectRatio } from "@radix-ui/react-aspect-ratio";
import { Spotify } from 'react-spotify-embed';
import { ArtistSpotifyImage } from "@/server/utils/externalApiQueries";
import { Artist } from "@/server/db/DbTypes";

export default function Dashboard({spotifyImg, artist} : {spotifyImg: ArtistSpotifyImage, artist: Artist}) {
    return (
        <>
            {(spotifyImg) &&
                <div className="flex flex-col items-center md:items-end">

                    <AspectRatio ratio={1 / 1} className="flex items-center place-content-center bg-muted rounded-md overflow-hidden w-full mb-4">
                        {(spotifyImg) ?
                            <img src={spotifyImg.artistImage} alt="Image not available" className="object-cover w-full h-full" />
                            :
                            <img className="" src="/spinner.svg" alt="whyyyyy" />
                        }
                    </AspectRatio>
                    <div className="w-full">
                        {/* frame to crop out the artist image in spotify iframe */}
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
                </div>
            }
        </>
    )
}