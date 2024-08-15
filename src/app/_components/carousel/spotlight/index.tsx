
"use client"
import Link from "next/link"

export default function Spotlight({image, id}: {image: string, id: string}) {
    // conditionally render

    return (
        image ? (
            <Link href={`/artist/${id}`}>
                <img src={image} alt="art1"/>
            </Link>
        ) : (
            <div>no image</div>
        )
    )
    
}