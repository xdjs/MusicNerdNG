"use client"

import * as React from "react";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import AutoScroll from 'embla-carousel-auto-scroll';
import {
    Carousel,
    CarouselContent,
    CarouselItem,
} from "@/components/ui/carousel";
import Spotlight from "@/app/_components/carousel/spotlight";
import { FeaturedArtist } from "@/server/utils/externalApiQueries";

type directionType = "forward" | "backward" | undefined;
export type artistDataType = { name: string, spotify: string, id: string };

function ArtistFrame({ image, id}: { image: string, id: string }) {
    return (
        <CarouselItem className="basis-1/2 md:basis-1/3 lg:basis-1/5 py-2">
            <AspectRatio ratio={1 / 1} className="bg-muted rounded-md overflow-hidden">
                <Spotlight image={image} id={id} />
            </AspectRatio>
        </CarouselItem>
    )
}

export default function ArtistCarousel({ speed, direction, featuredArtists }: { speed: number, direction: directionType, featuredArtists: FeaturedArtist[] }) {
    return (
        <Carousel className="w-full" plugins={[
            AutoScroll({ stopOnInteraction: false, speed: speed, direction: direction })
        ]}
        >
            <CarouselContent>
                {featuredArtists ? (
                    featuredArtists.map((artist) => (
                        <ArtistFrame key={artist.artistId} image={artist.artistImage} id={artist.artistId} />
                    ))
                ) : (
                    <div>No artists available</div>
                )}
            </CarouselContent>
        </Carousel>
    )
}
