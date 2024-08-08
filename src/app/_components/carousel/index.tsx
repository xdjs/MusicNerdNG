"use client"
import * as React from "react"

import { Card, CardContent } from "@/components/ui/card"
import AutoScroll from 'embla-carousel-auto-scroll' 
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"

type directionType = "forward"|"backward"|undefined

export default function ArtistCarousel({direction, speed}: {direction:directionType, speed:number}) {
  return (
    <Carousel className="w-full" plugins={[
        AutoScroll({stopOnInteraction: false, speed: speed, direction: direction})
    ]}
    >
      <CarouselContent>
        {Array.from({ length: 10 }).map((_, index) => (
          <CarouselItem className="basis-1/5" key={index}>
            <div className="p-1">
              <Card>
                <CardContent className="flex aspect-square items-center justify-center p-6">
                  <span className="text-4xl font-semibold">{index + 1}</span>
                </CardContent>
              </Card>
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  )
}
