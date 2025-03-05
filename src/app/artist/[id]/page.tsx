import {  getArtistLinks, getArtistByProperty } from "@/server/utils/queriesTS";
import { getSpotifyImage} from "@/server/utils/externalApiQueries";

import { getServerAuthSession } from "@/server/auth";
import { notFound } from "next/navigation";
import Dashboard2 from "./_components/Dashboard2";
import LLMChat from "./_components/LLMChat";
import getAiResponse from "@/server/utils/AiBro";
import { artists } from "@/server/db/schema";
import { addArtistBySystem } from "@/server/utils/queriesTS";

type ArtistProfileProps = {
    params: { id: string };
    searchParams: { [key: string]: string | undefined };
}

export default async function ArtistProfile({ params, searchParams }: ArtistProfileProps) {
    let [session, artist] = await Promise.all([getServerAuthSession(), getArtistByProperty(artists.spotify, params.id)]);
    if (!artist.data) {
        const resp = await addArtistBySystem(params.id);
        if (!resp.newArtist) return notFound();
        artist.data = resp.newArtist;
    }

    const { opADM } = searchParams;

    const [spotifyImg, allLinks, aiResponse] = await Promise.all([
        getSpotifyImage(artist.data.spotify ?? "", undefined),
        getArtistLinks(artist.data),
        getAiResponse(artist.data.name ?? "")
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