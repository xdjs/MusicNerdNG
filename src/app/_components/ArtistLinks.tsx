import Link from "next/link";
import { Artist } from "@/server/db/DbTypes";
import { getArtistLinks } from "@/server/utils/queriesTS";

function PlatformLink({ link, descriptor, image }: { link: string, descriptor: string, image: string }) {
    return (
        <li className={`mb-5 list-none`}>
            <Link href={`${link}`} target="blank" className="text-black">
                <div className="link-item-grid gap-x-4 corners-rounded">
                    <img className="mr-3" src={image} alt="" height={50} width={50} />
                    <label className="pr-4"> {descriptor} </label>
                </div>
            </Link>
        </li>
    )
}

export default async function ArtistLinks({ isOnlyWeb3Sites, artist }: { isOnlyWeb3Sites: boolean, artist: Artist }) {
    let artistLinks = await getArtistLinks(artist);
    artistLinks = artistLinks.filter(el => el.isweb3Site === isOnlyWeb3Sites);
    
    return (
        artistLinks?.map(el => {
            return (<PlatformLink key={el.cardplatformname} descriptor={el.carddescription.replace('%@', el.cardplatformname)} link={el.artistUrl} image={el.siteImage ?? ""} />)
        })
    )
}