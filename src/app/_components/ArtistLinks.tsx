import Link from "next/link";
import { Artist, UrlMap } from "@/server/db/DbTypes";
import { getArtistLinks } from "@/server/utils/queriesTS";
import AddArtistData from "@/app/artist/[id]/_components/AddArtistData";
import { Session } from "next-auth";

function PlatformLink({ link, descriptor, image }: { link: string, descriptor: string, image: string }) {
    return (
        <li className={`list-none`}>
            <Link href={`${link}`} target="blank" className="text-black">
                <div className="link-item-grid gap-x-4 corners-rounded">
                    <img className="mr-3" src={image} alt="" height={50} width={50} />
                    <label className="pr-4 cursor-pointer"> {descriptor} </label>
                </div>
            </Link>
        </li>
    )
}

export default async function ArtistLinks({ isMonetized, artist, spotifyImg, session, availableLinks, isOpenOnLoad = false }: { isMonetized: boolean, artist: Artist, spotifyImg: string, session: Session | null, availableLinks: UrlMap[], isOpenOnLoad: boolean }) {
    let artistLinks = await getArtistLinks(artist);
    artistLinks = artistLinks.filter(el => el.isMonetized === isMonetized);
    if (artistLinks.length === 0) {
        return (
            <div>
                <p>This artist has no links in this section, help support them by adding links!</p>
                <div className="flex justify-start pt-4">
                    <AddArtistData artist={artist} spotifyImg={spotifyImg} session={session} availableLinks={availableLinks} isOpenOnLoad={isOpenOnLoad} />
                </div>
            </div>
        )
    }
    return (
        artistLinks?.map(el => {
            return (<PlatformLink key={el.cardPlatformName} descriptor={el.cardDescription?.replace('%@', el.cardPlatformName ?? "") ?? ""} link={el.artistUrl} image={el.siteImage ?? ""} />)
        })
    )
}