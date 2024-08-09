"use client"
import * as React from "react"
import Link from "next/link"
import Image from "next/image"

import { Card, CardContent } from "@/components/ui/card"
import AutoScroll from 'embla-carousel-auto-scroll'
import {
    Carousel,
    CarouselContent,
    CarouselItem,
} from "@/components/ui/carousel"

import Spotlight from "@/app/_components/carousel/spotlight"
import { getFeaturedQueries } from "@/utils/getFeatured" 
import { encodeParseQuery } from '@parse/react-ssr';

type directionType = "forward" | "backward" | undefined

export async function getServerSideProps() {
    const artistQuery = getFeaturedQueries();
  
    // Parse's weird way of getting the data server side
    const artistResults = await encodeParseQuery(artistQuery);
  
    const artists = (artistResults.findResult as any).map((e: any) => e.FeaturedArtist);
  
    return {
      props: {
        artists,
      },
    };
  }

function ArtistProfileBtn({artist}: {artist: any}) {
    return (
        <CarouselItem className="basis-1/2 md:basis-1/3 lg:basis-1/5 py-2">
            <div>
                <Card>
                    <CardContent className="flex aspect-square items-center justify-center p-0">
                        <Spotlight props={artist} />
                    </CardContent>
                </Card>
            </div>
        </CarouselItem>
    )
}

export default function ArtistCarousel({ direction, speed, artists }: { direction: directionType, speed: number, artists: any }) {
    return (
        <Carousel className="w-full" plugins={[
            AutoScroll({ stopOnInteraction: false, speed: speed, direction: direction })
        ]}
        >
            <CarouselContent>
                {Array.from({ length: 10 }).map((_, index) => (
                        <ArtistProfileBtn artist={} key={index} />
                ))}
            </CarouselContent>
        </Carousel>
    )
}
