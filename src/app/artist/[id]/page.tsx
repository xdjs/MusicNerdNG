
import { getArtistById, getAllLinks, getArtistLinks, getArtistByProperty } from "@/server/utils/queriesTS";
import { getSpotifyImage, getArtistWiki, getSpotifyHeaders, getNumberOfSpotifyReleases } from "@/server/utils/externalApiQueries";
import { AspectRatio } from "@radix-ui/react-aspect-ratio";
import { Spotify } from 'react-spotify-embed';
import ArtistLinks from "@/app/_components/ArtistLinks";
import { getArtistDetailsText } from "@/server/utils/services";
import Link from "next/link";
import AddArtistData from "./_components/AddArtistData";
import { getServerAuthSession } from "@/server/auth";
import { notFound } from "next/navigation";
import Dashboard2 from "./_components/Dashboard2";
import LLMChat from "./_components/LLMChat";
import getAiResponse from "@/server/utils/AiBro";
import { artists } from "@/server/db/schema";

type ArtistProfileProps = {
    params: { id: string };
    searchParams: { [key: string]: string | undefined };
}

export default async function ArtistProfile({ params, searchParams }: ArtistProfileProps) {
    const session = await getServerAuthSession();
    const artist = await getArtistByProperty(artists.spotify, params.id);
    if (!artist.data) {
        return notFound();
    }
    const { opADM } = searchParams;

    const [spotifyImg, numReleases, wiki, allLinks, aiResponse] = await Promise.all([
        getSpotifyImage(artist.data.spotify ?? "", undefined),
        getNumberOfSpotifyReleases(artist.data.spotify ?? ""),
        getArtistWiki(artist.data.wikipedia ?? ""),
        getArtistLinks(artist.data),
        getAiResponse(`Give me a 430 characterbio of the artist ${JSON.stringify(artist)} be casual and focus on web3 only if they are a web3 artist don't add any extra details of how the composition was made`)
    ]);

    return (
        <section className="relative block md:grid md:grid-cols-2 items-center justify-center py-5 px-4 gap-8 auto-rows-fr max-w-[1000px] mx-auto">
            <div>
                <Dashboard2 bio={aiResponse.response} artist={artist.data} img={spotifyImg.artistImage} session={session} availableLinks={allLinks} isOpenOnLoad={opADM === "1"} />
            </div>
            <div className="hidden md:block">
                <LLMChat artist={artist.data} />
            </div>
        </section>
    )
}