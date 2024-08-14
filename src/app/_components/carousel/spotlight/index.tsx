
"use client"
import Link from "next/link"

export default function Spotlight({image}: {image: string}) {
    // conditionally render 
    return (
        image ? (
            <Link href={`/artist/${image}`}>
                <img src={image} alt="art1"/>
            </Link>
        ) : (
            <div>no image</div>
        )
    )
    
}