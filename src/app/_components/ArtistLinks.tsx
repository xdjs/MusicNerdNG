import Link from "next/link";
import { Artist, UrlMap } from "@/server/db/DbTypes";
import { getArtistLinks } from "@/server/utils/queriesTS";
import AddArtistData from "@/app/artist/[id]/_components/AddArtistData";
import { Session } from "next-auth";
import EditablePlatformLink from "./EditablePlatformLink";

function StaticPlatformLink({ link, descriptor, image }: { link: string; descriptor: string; image: string }) {
    return (
        <li className="list-none">
            <Link href={`${link}`} target="blank" className="text-black">
                <div className="link-item-grid gap-x-4 corners-rounded">
                    <img className="mr-3" src={image} alt="" height={50} width={50} />
                    <label className="pr-4 cursor-pointer"> {descriptor} </label>
                </div>
            </Link>
        </li>
    );
}

export default async function ArtistLinks({ isMonetized, artist, spotifyImg, session, availableLinks, isOpenOnLoad = false, canEdit = false, showAddButton = true }: { isMonetized: boolean; artist: Artist; spotifyImg: string; session: Session | null; availableLinks: UrlMap[]; isOpenOnLoad: boolean; canEdit?: boolean; showAddButton?: boolean }) {
    let artistLinks = await getArtistLinks(artist);
    artistLinks = artistLinks.filter((el) => el.isMonetized === isMonetized && el.siteName !== 'spotify');
    
    // Render differently depending on monetization flag
    if (isMonetized) {
        // SUPPORT SECTION – never render the add button here
        if (artistLinks.length === 0) {
            return (
                <p>This artist has no links in this section yet.</p>
            );
        }
        return (
            artistLinks.map((el) => (
                <StaticPlatformLink
                    key={el.cardPlatformName}
                    descriptor={el.cardDescription?.replace('%@', el.cardPlatformName ?? "") ?? ""}
                    link={el.artistUrl}
                    image={el.siteImage ?? ""}
                />
            ))
        );
    }

    // GENERAL LINKS SECTION – always show the add button at the top and align with other list items
    return (
        <>
            {showAddButton && (
                <li className="list-none pb-2">
                    <div className="link-item-grid gap-x-4 corners-rounded items-center">
                        <AddArtistData label="Add data" artist={artist} spotifyImg={spotifyImg} availableLinks={availableLinks} isOpenOnLoad={isOpenOnLoad} />
                    </div>
                </li>
            )}
            {artist.spotify && artist.spotify.trim() !== "" && (
                <StaticPlatformLink
                    key="spotify"
                    descriptor="Listen on Spotify"
                    link={`https://open.spotify.com/artist/${artist.spotify}`}
                    image="/siteIcons/spotify_icon.svg"
                />
            )}
            {artistLinks.length === 0 ? (
                <p>This artist has no links in this section yet, help support them by adding links!</p>
            ) : null}
            {artistLinks.map((el) => (
                canEdit ? (
                    <EditablePlatformLink
                        key={el.cardPlatformName}
                        descriptor={el.cardDescription?.replace('%@', el.cardPlatformName ?? "") ?? ""}
                        link={el.artistUrl}
                        image={el.siteImage ?? ""}
                        siteName={el.siteName}
                        artistId={artist.id}
                    />
                ) : (
                    <StaticPlatformLink
                        key={el.cardPlatformName}
                        descriptor={el.cardDescription?.replace('%@', el.cardPlatformName ?? "") ?? ""}
                        link={el.artistUrl}
                        image={el.siteImage ?? ""}
                    />
                )
            ))}
        </>
    );
}