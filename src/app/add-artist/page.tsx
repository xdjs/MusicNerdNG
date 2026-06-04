import { getServerAuthSession } from "@/server/auth";
import { redirect } from "next/navigation";
import { deezerProvider, spotifyProvider } from "@/server/utils/musicPlatform";
import AddArtistContent from "./_components/AddArtistContent";

export default async function AddArtistPage({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | undefined }>;
}) {
    const session = await getServerAuthSession();
    if (!session) {
        redirect('/');
    }

    const params = await searchParams;
    const deezerId = params.deezer;
    const spotifyId = params.spotify;
    const platform = deezerId ? 'deezer' : spotifyId ? 'spotify' : null;
    const platformId = deezerId || spotifyId;

    if (!platform || !platformId) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center gap-4">
                <div className="text-xl">No artist ID provided</div>
            </div>
        );
    }

    const provider = platform === 'deezer' ? deezerProvider : spotifyProvider;
    const artistData = await provider.getArtist(platformId);

    if (!artistData) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center gap-4">
                <div className="text-red-500 text-xl">Could not find artist on {platform}</div>
            </div>
        );
    }

    return <AddArtistContent initialArtist={artistData} />;
}
