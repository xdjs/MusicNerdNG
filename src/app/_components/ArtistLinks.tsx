import Link from "next/link";
import { Artist } from "@/server/db/DbTypes";
import { getArtistLinks } from "@/server/utils/queriesTS";

function PlatformLink({ link, descriptor, image }: { link: string, descriptor: string, image: string }) {
    return (
        <li className={`mb-5 list-none`}>
            <Link href={`${link}`} target="blank" className="text-black">
                <div className="link-item-grid gap-x-4 corners-rounded">
                    <img className="mr-3" src={image} alt="" height={50} width={50} />
                    <label className="pr-4 cursor-pointer"> {descriptor} </label>
                </div>
            </Link>
        </li>
    )
}

export default async function ArtistLinks({ isMonetized, artist }: { isMonetized: boolean, artist: Artist }) {
    let artistLinks = await getArtistLinks(artist);
    artistLinks = artistLinks.filter(el => el.isMonetized === isMonetized);
    
    return (
        artistLinks?.map(el => {
            return (<PlatformLink key={el.cardPlatformName} descriptor={el.cardDescription?.replace('%@', el.cardPlatformName ?? "")?? ""} link={el.artistUrl} image={el.siteImage ?? ""} />)
        })
    )
}