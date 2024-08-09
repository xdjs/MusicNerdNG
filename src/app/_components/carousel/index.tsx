"use client"
import * as React from "react"
import Link from "next/link"

import { Card, CardContent } from "@/components/ui/card"
import AutoScroll from 'embla-carousel-auto-scroll'
import {
    Carousel,
    CarouselContent,
    CarouselItem,
    CarouselNext,
    CarouselPrevious,
} from "@/components/ui/carousel"

type directionType = "forward" | "backward" | undefined

function ArtistProfileBtn() {
    return (
        <CarouselItem className="basis-1/2 md:basis-1/3 lg:basis-1/5 py-2">
            <div>
                <Card>
                    <CardContent className="flex aspect-square items-center justify-center p-0">
                        <Link href={"/"}>
                            <img className="rounded w-full" src="/artist1.jpg" alt="art1" />
                        </Link>
                    </CardContent>
                </Card>
            </div>
        </CarouselItem>
    )
}

export default function ArtistCarousel({ direction, speed }: { direction: directionType, speed: number }) {
    return (
        <Carousel className="w-full" plugins={[
            AutoScroll({ stopOnInteraction: false, speed: speed, direction: direction })
        ]}
        >
            <CarouselContent>
                {Array.from({ length: 10 }).map((_, index) => (
                        <ArtistProfileBtn key={index} />
                ))}
            </CarouselContent>
        </Carousel>
    )
}
