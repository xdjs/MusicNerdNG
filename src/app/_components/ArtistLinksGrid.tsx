import { Artist, UrlMap } from "@/server/db/DbTypes";
import { getArtistLinks } from "@/server/utils/queries/artistQueries";
import EditableLinkIcon from "./EditableLinkIcon";

/** Platforms that should always appear in "Support the Artist" regardless of DB isMonetized flag */
const FORCE_SUPPORT_PLATFORMS = new Set(["bandcamp", "catalog", "sound", "supercollector"]);

interface ArtistLinksGridProps {
    isMonetized: boolean;
    artist: Artist;
    availableLinks: UrlMap[];
    canEdit?: boolean;
}

export default async function ArtistLinksGrid({ isMonetized, artist, canEdit = false }: ArtistLinksGridProps) {
    let artistLinks = await getArtistLinks(artist);
    artistLinks = artistLinks.filter((el) => {
        if (el.siteName === "spotify" || el.siteName === "deezer") return false;
        const forcedSupport = FORCE_SUPPORT_PLATFORMS.has(el.siteName);
        if (isMonetized) {
            return el.isMonetized || forcedSupport;
        }
        return !el.isMonetized && !forcedSupport;
    });

    // For non-monetized, prepend Spotify and Deezer if they exist
    const showSpotify = !isMonetized && artist.spotify && artist.spotify.trim() !== "";
    const showDeezer = !isMonetized && artist.deezer && artist.deezer.trim() !== "";

    if (!showSpotify && !showDeezer && artistLinks.length === 0) {
        return (
            <p className="text-sm text-muted-foreground">
                {isMonetized
                    ? "No support links yet."
                    : "No social links yet — help out by adding some!"}
            </p>
        );
    }

    return (
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-7 gap-3">
            {showSpotify && (
                canEdit ? (
                    <EditableLinkIcon
                        href={`https://open.spotify.com/artist/${artist.spotify}`}
                        siteName="spotify"
                        artistId={artist.id}
                        iconSrc="/siteIcons/spotify_icon.svg"
                        label="Spotify"
                    />
                ) : (
                    <a
                        href={`https://open.spotify.com/artist/${artist.spotify}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-col items-center gap-1.5 group"
                    >
                        <div className="w-12 h-12 rounded-full backdrop-blur-sm bg-white/70 dark:bg-white/10 border border-white/40 dark:border-white/15 shadow-sm flex items-center justify-center overflow-hidden transition-all duration-300 group-hover:scale-110 group-hover:shadow-[0_0_15px_rgba(239,149,255,0.45)] group-hover:bg-white/90 dark:group-hover:bg-white/20">
                            <img
                                src="/siteIcons/spotify_icon.svg"
                                alt="Spotify"
                                className="w-7 h-7 object-contain"
                            />
                        </div>
                        <span className="text-xs text-center text-muted-foreground leading-tight truncate w-full">
                            Spotify
                        </span>
                    </a>
                )
            )}
            {showDeezer && (
                canEdit ? (
                    <EditableLinkIcon
                        href={`https://www.deezer.com/artist/${artist.deezer}`}
                        siteName="deezer"
                        artistId={artist.id}
                        iconSrc="/siteIcons/deezer_icon.svg"
                        label="Deezer"
                    />
                ) : (
                    <a
                        href={`https://www.deezer.com/artist/${artist.deezer}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-col items-center gap-1.5 group"
                    >
                        <div className="w-12 h-12 rounded-full backdrop-blur-sm bg-white/70 dark:bg-white/10 border border-white/40 dark:border-white/15 shadow-sm flex items-center justify-center overflow-hidden transition-all duration-300 group-hover:scale-110 group-hover:shadow-[0_0_15px_rgba(239,149,255,0.45)] group-hover:bg-white/90 dark:group-hover:bg-white/20">
                            <img
                                src="/siteIcons/deezer_icon.svg"
                                alt="Deezer"
                                className="w-7 h-7 object-contain"
                            />
                        </div>
                        <span className="text-xs text-center text-muted-foreground leading-tight truncate w-full">
                            Deezer
                        </span>
                    </a>
                )
            )}
            {artistLinks.map((el) => (
                canEdit ? (
                    <EditableLinkIcon
                        key={el.siteName}
                        href={el.artistUrl}
                        siteName={el.siteName}
                        artistId={artist.id}
                        iconSrc={el.siteImage ?? ""}
                        label={el.cardPlatformName ?? el.siteName}
                    />
                ) : (
                    <a
                        key={el.siteName}
                        href={el.artistUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-col items-center gap-1.5 group"
                    >
                        <div className="w-12 h-12 rounded-full backdrop-blur-sm bg-white/70 dark:bg-white/10 border border-white/40 dark:border-white/15 shadow-sm flex items-center justify-center overflow-hidden transition-all duration-300 group-hover:scale-110 group-hover:shadow-[0_0_15px_rgba(239,149,255,0.45)] group-hover:bg-white/90 dark:group-hover:bg-white/20">
                            <img
                                src={el.siteImage ?? ""}
                                alt={el.cardPlatformName ?? el.siteName}
                                className="w-7 h-7 object-contain"
                            />
                        </div>
                        <span className="text-xs text-center text-muted-foreground leading-tight truncate w-full">
                            {el.cardPlatformName ?? el.siteName}
                        </span>
                    </a>
                )
            ))}
        </div>
    );
}
