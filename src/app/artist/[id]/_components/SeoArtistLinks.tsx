import { Artist } from "@/server/db/DbTypes";
import { getArtistLinks } from "@/server/utils/queries/artistQueries";

/**
 * Server-rendered social links for SEO crawlability.
 * These links are visually hidden but present in the initial HTML
 * for search engines to index.
 */
export default async function SeoArtistLinks({ artist }: { artist: Artist }) {
    const artistLinks = await getArtistLinks(artist);

    // Filter to only non-monetized social links (excluding spotify and deezer, which are handled separately)
    const socialLinks = artistLinks.filter(
        (link) => !link.isMonetized && link.siteName !== "spotify" && link.siteName !== "deezer"
    );

    if (socialLinks.length === 0 && !artist.spotify && !artist.deezer) {
        return null;
    }

    return (
        <nav aria-label="Artist social links" className="sr-only">
            <ul>
                {artist.spotify && (
                    <li>
                        <a href={`https://open.spotify.com/artist/${artist.spotify}`}>
                            {artist.name} on Spotify
                        </a>
                    </li>
                )}
                {artist.deezer && (
                    <li>
                        <a href={`https://www.deezer.com/artist/${artist.deezer}`}>
                            {artist.name} on Deezer
                        </a>
                    </li>
                )}
                {socialLinks.map((link) => (
                    <li key={link.siteName}>
                        <a href={link.artistUrl}>
                            {artist.name} on {link.cardPlatformName}
                        </a>
                    </li>
                ))}
            </ul>
        </nav>
    );
}
