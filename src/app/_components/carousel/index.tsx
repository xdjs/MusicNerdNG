"use client"
import * as React from "react";
import Link from "next/link";
import Image from "next/image";


import { Card, CardContent } from "@/components/ui/card"
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

function ArtistProfileBtn({artist}: {artist: artistDataType}) {
    return (
        <CarouselItem className="basis-1/2 md:basis-1/3 lg:basis-1/5 py-2">
            <div>
                <Card>
                    <CardContent className="flex aspect-square items-center justify-center p-0">
                        <Spotlight artist={artist} />
                    </CardContent>
                </Card>
            </div>
        </CarouselItem>
    )
}

export default function ArtistCarousel({speed, direction}: {speed: number, direction: directionType}) {
    const [data, setData] = useState<Array<artistDataType>>();

    useEffect(() => {
        const getArtists = async () => {
            const artists = await getFeaturedArtists();
            console.log(artists)
            setData(artists);
        }
        getArtists();
    }, [])

    return (
        <Carousel className="w-full" plugins={[
            AutoScroll({ stopOnInteraction: false, speed: speed, direction: direction })
        ]}
        >
            <CarouselContent>
                {data ? (
                    data.map(artist => (
                        <ArtistProfileBtn key={artist.spotify} artist={artist} />
                    ))
                ) : (
                    <div>No artists available</div>
                )}
            </CarouselContent>
        </Carousel>
    )
}
