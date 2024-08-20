"use client"

import { useEffect, useState } from "react";
import { getArtist } from "@/utils/queries";
import { getSpotifyHeaders, getWiki, getSpotify } from "@/utils/getInfo"
import axios from "axios";
import { AspectRatio } from "@radix-ui/react-aspect-ratio";
import Link from "next/link";
import { getArtistDetailsText, getArtistSplitPlatforms } from "@/utils/getText"
import { Spotify } from 'react-spotify-embed';
import LinkList from "@/app/_components/linkList";

export type artistDataType = {
    name: string, 
    spotify: string, 
    objectId: string,
    audius: string,
    bandsintown: string,
    catalog: string,
    ens: string,
    x: string,
    facebook: string,
    instagram: string,
    lastfm: string,
    lcname: string,
    soundcloud: string,
    soundcloudId: number,
    tiktok: string,
    twitter: string,
    updatedAt: string,
    wallets: Array<string>,
    wikipedia: string,
    youtubechannel: string,
    zora: string
}

type artistWikiType = {
    blurb: any,
    link: string,
}

type spotifyDataType = {
    releases: number
}


export default function ArtistProfile({ params }: { params: { id: string } }) {
    const [artistData, setArtistData] = useState<artistDataType>(); 
    const [image, setImage] = useState<string>(); 
    const [spotifyData, setSpoifyData] = useState<spotifyDataType>();
    const [artistWiki, setArtistWiki] = useState<artistWikiType>();
    const [supportLinks, setSupportLinks] = useState<Array<string>>([]);

    useEffect(()=> {
        const getArtistData = async () => {
            try {
                console.log(`making request ${params.id}`)
                return await getArtist(params.id);
            } catch (error) {
                console.error("Error fetching artists", error);
                return []
            }
        }
        
        const getWeb3Presences = async (artist: artistDataType) => {
            try {
                console.log(`making web3 request`)
                return await getArtistSplitPlatforms(artist).web3Platforms;
            } catch (error) {
                console.error("Error fetching web3", error);
                return []
            }
        }

        const getSpotifyImage = async (artist: artistDataType): Promise<string> => {
            try {
                const headers = await getSpotifyHeaders();
                const artistData = await axios.get(
                    `https://api.spotify.com/v1/artists/${artist.spotify}`,
                    headers
                );
                return artistData.data.images[0].url;
            } catch (error) {
                console.error(`Error fetching image for artist ${artist.spotify}`, error);
                return '';
            }
        };

        const fetchImage = async (artistData: artistDataType) => {
            const imageUrl = await getSpotifyImage(artistData);
            setImage(imageUrl);
        };

        const initialize = async () => {
            const data = await getArtistData();
            setArtistData(data);
            fetchImage(data);
            setArtistWiki(await getWiki(data.wikipedia));
            setSpoifyData(await getSpotify(data.spotify));
            setSupportLinks(await getWeb3Presences(data));
        };

        initialize();
    }, [])

    return (
        <div className="gap-4 px-4 sm:flex">
            {/* Artist Info Box */}
            <div className="bg-white rounded-lg md:w-2/3 gap-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 px-10 py-10 w-full">
                    {/* Left Column: Name and Description */}
                    <div className="flex flex-col justify-start md:col-span-2">
                        <strong className="text-black text-2xl mb-2">
                            {artistData?.name}
                        </strong>
                        <div className="text-black pt-10 mb-4">
                            {(artistData) && getArtistDetailsText(artistData, spotifyData)}
                        </div>
                        <p className="text-black mb-4">
                            {artistWiki?.blurb}
                        </p>
                        {(artistWiki) ?
                            <Link href={`${artistWiki?.link}`} className="text-black underline mb-4 pb-10">
                                {"WIKIPEDIA"}
                            </Link>
                            :
                            <div className="text-black pb-10">
                                Unfortunately {artistData?.name} currently has no attached wikipedia.
                            </div>
                        }

                    </div>
    
                    {/* Right Column: Image and Song */}
                    <div className="pb-1 flex flex-col items-center md:items-end">
                        <AspectRatio ratio={1 / 1} className="bg-muted rounded-md overflow-hidden w-full mb-4">
                            <img src={image} alt="artist" className="object-cover w-full h-full"/>
                        </AspectRatio>
                    </div>
                </div>
                <div className="px-10 pb-6">
                    {/* frame to crop out the artist image in spotify iframe */}
                    <div className="flex justify-center md:justify-end overflow-hidden w-full rounded-l-xl">
                        <div style={{
                            clipPath: 'inset(0 0 0 72px)',
                            width: 'calc(100% + 72px)',
                            marginLeft: '-72px',
                        }}>
                            <Spotify wide link={`https://open.spotify.com/artist/${artistData?.spotify}`} />
                        </div>
                    </div>
                </div>
                <div className="ml-10 py-10 pr-10">
                    <strong className="text-black text-2xl">
                        Check out {artistData?.name} on other media platforms!
                    </strong>
                    <div className="pt-6">
                        {(artistData) &&
                            <LinkList support={false} artistData={artistData}/>
                        }
                    </div>
                </div>
            </div>
    
            {/* Support Artist Box - Fixed Sidebar */}
            <div className="bg-white px-6 pb-6 rounded-lg shadow-lg flex flex-col md:w-1/3">
                <div className="top-0 sticky">
                    <div className="text-center py-10 text-black text-2xl">
                        <strong>
                            Support Artist
                        </strong>
                    </div>
                    <div className="pl-4">
                        {(artistData) &&
                                <LinkList support={true} artistData={artistData}/>
                            }
                    </div>
                </div>
            </div>
        </div>
    );          
}