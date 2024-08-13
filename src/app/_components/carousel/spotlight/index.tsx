
"use client"
import Link from "next/link"
import Image from "next/image"
import {getSpotifyHeaders} from "@/utils/getInfo"
import axios from "axios"
import { artistDataType } from ".."
import { useState } from "react"
import { useEffect } from "react"

export default function Spotlight({artist}: {artist: artistDataType}) {
    // state for image
    const [image, setImage] = useState<string>("");

    // useeffect to retreive the url on mount 
    useEffect(() => {
        const getSpotifyImage = async () => {
            const headers = await getSpotifyHeaders();
            const artistData = await axios.get( 
                `https://api.spotify.com/v1/artists/${artist.spotify}`,
                headers
            );
            setImage(artistData.data.images[0].url);
        }

        
        getSpotifyImage();
    }, [])

    // conditionally render 
    return (
        image ? (
            <Link href={`/artist/${artist.name}`}>
                <img className="rounded w-full" src={image} alt="art1"/>
            </Link>
        ) : (
            <div>no image</div>
        )
    )
    
}