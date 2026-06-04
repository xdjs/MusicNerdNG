import { Artist } from "@/server/db/DbTypes";
import { getArtistLinks } from "@/server/utils/queries/artistQueries";
import { ArtistDetail, SocialLink } from "../types";

export async function toArtistDetail(artist: Artist): Promise<ArtistDetail> {
  const artistLinks = await getArtistLinks(artist);

  const socialLinks: Record<string, SocialLink> = {};

  for (const link of artistLinks) {
    // Use siteName as the key (lowercase platform identifier per PRD spec)
    const platformName = link.siteName;

    // Extract the handle from the artist object using siteName as the key
    // Handle the special case where siteName is "facebookID" but artist property is "facebookId"
    const artistPropertyName = link.siteName === "facebookID" ? "facebookId" : link.siteName;
    let handle = (artist as Record<string, unknown>)[artistPropertyName]?.toString() ?? "";
    // Normalize YouTube handles — strip leading @ for consistency
    if ((platformName === "youtube" || platformName === "youtubechannel") && handle.startsWith("@")) {
      handle = handle.substring(1);
    }

    socialLinks[platformName] = {
      handle,
      url: link.artistUrl,
    };
  }

  return {
    id: artist.id,
    name: artist.name ?? "",
    bio: artist.bio ?? null,
    spotifyId: artist.spotify ?? null,
    deezerId: artist.deezer ?? null,
    socialLinks,
  };
}
