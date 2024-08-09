import Link from "next/link"
import Image from "next/image"

export default function Spotlight(props) {
    return (
        <Link href={""}>
            <Image className="rounded w-full" src="/artist1.jpg" alt="art1" height={300} width={300} />
        </Link>
    )
}