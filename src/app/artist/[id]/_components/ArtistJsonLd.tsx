import { Artist } from "@/server/db/DbTypes";
import { getArtistLinks } from "@/server/utils/queries/artistQueries";
import { isRealBio } from "@/lib/bioConstants";

/**
 * The page, said in a way a machine can read.
 *
 * The measurement that prompted this: an artist page fetched as Googlebot
 * already contains the name, the bio and every link in its initial HTML — this
 * is a server-rendered app and the worry that "bots cannot execute the
 * JavaScript so there is nothing to scrape" does not apply to it. What was
 * missing was smaller and more specific. A crawler got prose and had to infer
 * from it that this page is about a musician, that these eight URLs are the
 * same person's accounts, and which of the names in the paragraph is the
 * subject. schema.org says all three outright.
 *
 * `sameAs` is the part that matters most. It is the standard way to state "these
 * accounts are this entity", and it is what lets a search engine or an assistant
 * merge a Music Nerd page with what it already holds instead of treating it as
 * an unrelated document that happens to share a name. Namesakes are the whole
 * problem this pipeline fights; here we get to answer it in one field.
 *
 * Kept to what we can back. No aggregate ratings, no invented genres, no
 * founding dates — the same rule the vault runs on.
 */
export default async function ArtistJsonLd({
    artist,
    imageUrl,
    pageUrl,
}: {
    artist: Artist;
    imageUrl: string;
    pageUrl: string;
}) {
    const name = artist.name?.trim();
    if (!name) return null;

    const links = await getArtistLinks(artist).catch(() => []);
    const sameAs = [
        artist.spotify ? `https://open.spotify.com/artist/${artist.spotify}` : null,
        artist.deezer ? `https://www.deezer.com/artist/${artist.deezer}` : null,
        ...links.map(l => l.artistUrl),
    ].filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u));

    const data: Record<string, unknown> = {
        "@context": "https://schema.org",
        // MusicGroup covers a solo artist as well as a band, and is what the
        // music vocabulary is actually indexed under. Person would be more
        // precise for a producer and much less useful.
        "@type": "MusicGroup",
        name,
        url: pageUrl,
        // Not "@id: pageUrl" — the page is a document about the artist, and
        // conflating the two is the mistake that makes two artists with one
        // profile page look like one entity.
        mainEntityOfPage: pageUrl,
    };
    if (imageUrl) data.image = imageUrl.startsWith("http") ? imageUrl : `https://www.musicnerd.xyz${imageUrl}`;
    // isRealBio rejects the placeholder text the page shows before a bio has
    // been written. Publishing that as a description would tell a crawler the
    // artist is "a musician on Music Nerd", forever.
    if (artist.bio && isRealBio(artist.bio)) data.description = artist.bio.trim();
    if (sameAs.length > 0) data.sameAs = [...new Set(sameAs)];

    return (
        <script
            type="application/ld+json"
            // Only fields we assembled above reach this, and JSON.stringify
            // escapes the values. The one character that could still close the
            // tag early is "<".
            dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
        />
    );
}
