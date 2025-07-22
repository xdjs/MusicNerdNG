import Link from "next/link";
import { Artist, UrlMap } from "@/server/db/DbTypes";
import { getArtistLinks } from "@/server/utils/queries/artistQueries";
import AddArtistData from "@/app/artist/[id]/_components/AddArtistData";
import { Session } from "next-auth";
import EditablePlatformLink from "./EditablePlatformLink";

// Static link item – shows normal link when logged in, gray placeholder when logged out
function StaticPlatformLink({ link, descriptor, image, isLoggedIn }: { link: string; descriptor: string; image: string; isLoggedIn: boolean }) {
    // Logged-out users see a non-interactive gray box (same footprint)
    if (!isLoggedIn) {
        return (
            <li className="list-none">
                <div className="bg-gray-300 rounded-md h-12 w-full flex items-center justify-center">
                    <Link
                        href="#"
                        onClick={(e) => {
                            e.preventDefault();
                            const loginBtn = document.getElementById("login-btn") as HTMLButtonElement | null;
                            loginBtn?.click();
                        }}
                        className="px-4 py-2 bg-pastypink text-white rounded-md text-xs sm:text-sm hover:bg-pastypink/80 focus:outline-none"
                    >
                        Log in to view your statistics
                    </Link>
                </div>
            </li>
        );
    }

    // Logged-in users get the normal hyperlink behaviour
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
                    isLoggedIn={!!session}
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
                    <AddArtistData label="Add links" artist={artist} spotifyImg={spotifyImg} availableLinks={availableLinks} isOpenOnLoad={isOpenOnLoad} />
                </div>
            </li>
            )}
            {artist.spotify && artist.spotify.trim() !== "" && (
                <StaticPlatformLink
                    key="spotify"
                    descriptor="Listen on Spotify"
                    link={`https://open.spotify.com/artist/${artist.spotify}`}
                    image="/siteIcons/spotify_icon.svg"
                    isLoggedIn={!!session}
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
                        isLoggedIn={!!session}
                    />
                )
            ))}
        </>
    );
}