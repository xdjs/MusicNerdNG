"use client"

import { useEffect, useState } from "react";
import { getArtist } from "@/utils/queries";
import { getSpotifyHeaders, getWiki } from "@/utils/getInfo"
import axios from "axios";
import { AspectRatio } from "@radix-ui/react-aspect-ratio";
import Link from "next/link";

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

type enabledLinks = {

}


export default function ArtistProfile({ params }: { params: { id: string } }) {
    const [artistData, setArtistData] = useState<artistDataType>(); 
    const [image, setImage] = useState<string>(); 
    const [spotify, setSpoify] = useState<string>();
    const [artistWiki, setArtistWiki] = useState<artistWikiType>();
    const [links, setLinks] = useState<enabledLinks>()

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
            const data2 = await getWiki(data.wikipedia)
            setArtistWiki(data2);
            console.log(data)
        };

        initialize();
    }, [])

    return (
        <div className=" gap-3 px-3 sm:flex">
            {/* Artist Info Box */}
            <div
                className="bg-white rounded-lg"
            >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Left Column: Name and Description */}
                    <div className="flex flex-col justify-start md:col-span-2">
                        <strong className="text-black text-2xl mb-2">
                            {artistData?.name}
                            <span className="text-purple-500"> !!</span>
                        </strong>
                        <div className="text-blue-600 underline mb-4">
                            Lorem ipsum dolor sit amet, consectetur adipisicing elit. Odit nemo ipsam repellendus quidem necessitatibus voluptas?
                        </div>
                        <p className="text-black mb-4">
                            {artistWiki?.blurb}
                        </p>
                        <Link href={`${artistWiki?.link}`} className="text-black underline mb-4">
                            {(artistWiki) ? "WIKIPEDIA" : `${artistData?.name} currently has no attached wikipedia`}
                        </Link>

                    </div>
    
                    {/* Right Column: Image and Song */}
                    <div className="flex flex-col items-center md:items-end">
                        <AspectRatio ratio={1 / 1} className="bg-muted rounded-md overflow-hidden w-full mb-4">
                            <img src={image} alt="artist" className="object-cover w-full h-full"/>
                        </AspectRatio>
                        <div className="flex items-center mt-4 w-full justify-center md:justify-end">
                            <div className="bg-gray-300 p-2 rounded-lg text-black">
                                Play Button Placeholder
                            </div>
                            <span className="ml-2 text-black">Day By Day</span>
                        </div>
                    </div>
                </div>
            </div>
    
            {/* Support Artist Box - Fixed Sidebar */}
            <div className="right-0 h-full bg-white p-6 rounded-lg shadow-lg flex flex-col items-center"
                 style={{ top: '8.5rem' }} /* Adjusted top property for the sidebar */
            >
                <strong className="text-black text-2xl mb-4">
                    Support Artist
                </strong>
                <ul className="flex flex-col gap-4 items-center">

                </ul>
            </div>
        </div>
    );          
}