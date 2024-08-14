"use client"
import * as React from "react";
import {getSpotifyHeaders} from "@/utils/getInfo"
import axios from "axios"
 
import { AspectRatio } from "@/components/ui/aspect-ratio"

import AutoScroll from 'embla-carousel-auto-scroll'
import {
    Carousel,
    CarouselContent,
    CarouselItem,
} from "@/components/ui/carousel"

import Spotlight from "@/app/_components/carousel/spotlight"

import getFeaturedArtists from "@/utils/queries";
import { useEffect, useState } from "react";

type directionType = "forward" | "backward" | undefined
export type artistDataType = {name: string, spotify: string}
const direction = "forward"
const speed = .5

function ArtistFrame({image}: {image: string}) {
    return (
        <CarouselItem className="basis-1/2 md:basis-1/3 lg:basis-1/5 py-2">
            <AspectRatio ratio={1 / 1} className="bg-muted rounded-md overflow-hidden">
                <Spotlight image={image}/>
            </AspectRatio>
        </CarouselItem>
    )
}

export default function ArtistCarousel({speed, direction}: {speed: number, direction: directionType}) {
    const [images, setImages] = useState<Array<string>>([]);

    useEffect(() => {
        const getArtists = async () => {
            try {
                console.log("making request")
                return await getFeaturedArtists();
            } catch (error) {
                console.error("Error fetching artists", error);
                return [];
            }
        };

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

        const fetchImages = async (artists: Array<artistDataType>) => {
            const imageUrls = await Promise.all(
                artists.map(artist => getSpotifyImage(artist))
            );
            setImages(imageUrls);
        };

        const initialize = async () => {
            const artists = await getArtists();
            if (artists.length > 0) {
                await fetchImages(artists);
            }
        };

        initialize();

    }, []);
 
    return (
        <Carousel className="w-full" plugins={[
            AutoScroll({ stopOnInteraction: false, speed: speed, direction: direction })
        ]}
        >
            <CarouselContent>
                {images ? (
                    images.map(image => (
                        <ArtistFrame key={image} image={image} />
                    ))
                ) : (
                    <div>No artists available</div>
                )}
            </CarouselContent>
        </Carousel>
    )
}
