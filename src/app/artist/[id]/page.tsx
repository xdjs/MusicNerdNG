import { getArtistById, getAllLinks } from "@/server/utils/queries/artistQueries";
import { musicPlatformData } from "@/server/utils/musicPlatform";
import ArtistLinksGrid from "@/app/_components/ArtistLinksGrid";
import BookmarkButton from "@/app/_components/BookmarkButton";
import ClaimButton from "./_components/ClaimButton";
import { getServerAuthSession } from "@/server/auth";
import { getDevSession } from "@/server/utils/dev-auth";
import { getUserById } from "@/server/utils/queries/userQueries";
import { getClaimByArtistId } from "@/server/utils/queries/dashboardQueries";
import { notFound } from "next/navigation";
import { EditModeProvider } from "@/app/_components/EditModeContext";
import EditModeToggle from "@/app/_components/EditModeToggle";
import BlurbSection from "./_components/BlurbSection";
import AddArtistData from "@/app/artist/[id]/_components/AddArtistData";
import HeroSection from "./_components/HeroSection";
import VaultSection from "./_components/VaultSection";
import AskAboutArtist from "./_components/AskAboutArtist";
import RevealSection from "./_components/RevealSection";
import { getVaultSourcesByArtistId } from "@/server/utils/queries/dashboardQueries";
import AutoRefresh from "@/app/_components/AutoRefresh";
import type { Metadata } from "next";
import SeoArtistLinks from "./_components/SeoArtistLinks";

type ArtistProfileProps = {
    params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: ArtistProfileProps): Promise<Metadata> {
    const { id } = await params;
    const artist = await getArtistById(id);

    if (!artist) {
        return {
            title: "Artist Not Found | Music Nerd",
            description: "The requested artist could not be found on Music Nerd.",
        };
    }

    const platformData = await musicPlatformData.getArtist(artist);
    const imageUrl = artist.customImage
        ? `https://www.musicnerd.xyz${artist.customImage}`
        : platformData?.imageUrl || "https://www.musicnerd.xyz/default_pfp_pink.png";
    const artistName = artist.name ?? "Unknown Artist";

    return {
        title: `${artistName} | Music Nerd`,
        description: `Discover ${artistName}'s social links and streaming profiles on Music Nerd.`,
        openGraph: {
            type: "profile",
            title: `${artistName} | Music Nerd`,
            description: `Discover ${artistName}'s social links and streaming profiles on Music Nerd.`,
            url: `https://www.musicnerd.xyz/artist/${id}`,
            images: [
                {
                    url: imageUrl,
                    width: 640,
                    height: 640,
                    alt: `${artistName} profile image`,
                },
            ],
        },
        twitter: {
            card: "summary_large_image",
            title: `${artistName} | Music Nerd`,
            description: `Discover ${artistName}'s social links and streaming profiles on Music Nerd.`,
            images: [imageUrl],
        },
    };
}

export default async function ArtistProfile({ params }: ArtistProfileProps) {
    const { id } = await params;
    const session = await getServerAuthSession() ?? await getDevSession();
    const dbUser = session ? await getUserById(session.user.id) : null;
    const isAdmin = !!dbUser?.isAdmin;

    const artist = await getArtistById(id);
    if (!artist) {
        return notFound();
    }
    // Pending sources are fetched in parallel (indexed lookup) to avoid a serial
    // round-trip for editors; they are only exposed to the client when canEdit.
    const [platformData, urlMapList, existingClaim, approvedSources, pendingSourcesRaw] = await Promise.all([
        musicPlatformData.getArtist(artist),
        getAllLinks(),
        getClaimByArtistId(id),
        getVaultSourcesByArtistId(id, "approved"),
        getVaultSourcesByArtistId(id, "pending"),
    ]);

    const platformImage = platformData?.imageUrl ?? null;

    const isClaimed = !!existingClaim && existingClaim.status === "approved";
    const isPending = !!existingClaim && existingClaim.status === "pending";
    const isClaimedByUser = isClaimed && !!session && existingClaim.userId === session.user.id;
    const isPendingByUser = isPending && !!session && existingClaim.userId === session.user.id;
    const canEdit = isClaimedByUser || isAdmin;
    // Claim owners keep direct editing, including owners who are also admins.
    // Other admin/whitelisted additions use auto-approved UGC so they appear in the feed.
    const directEditLinks = isClaimedByUser;
    const autoApproveLinkSubmissions = isAdmin || !!dbUser?.isWhiteListed;

    const pendingSources = canEdit ? pendingSourcesRaw : [];

    const imageUrl = artist.customImage || platformImage || "/default_pfp_pink.png";

    return (
        <>
            <EditModeProvider canEdit={canEdit}>
            <AutoRefresh showLoading={false} />
            <div className="w-full max-w-[800px] mx-auto px-4 py-5 space-y-6">

                {/* 1. Hero Section */}
                <HeroSection imageUrl={imageUrl} artistName={artist.name ?? "Artist"} artistId={artist.id} />

                {/* 2. Name + Actions */}
                <div className="text-center space-y-2">
                    <h1 className="text-black dark:text-white text-2xl font-bold">
                        {artist.name}
                    </h1>
                    {/* Release count hidden for now — revisit when discography feature is built */}
                    <div className="flex flex-wrap justify-center items-center gap-2 pt-1">
                        <ClaimButton
                            artistId={artist.id}
                            isClaimed={isClaimed}
                            isClaimedByUser={isClaimedByUser}
                            isPending={isPending}
                            isPendingByUser={isPendingByUser}
                            artistInstagram={artist.instagram}
                        />
                        {session && (
                            <BookmarkButton
                                artistId={artist.id}
                                artistName={artist.name ?? ''}
                                imageUrl={platformImage ?? ''}
                                userId={session.user.id}
                            />
                        )}
                        {canEdit && <EditModeToggle />}
                    </div>
                </div>

                {/* 3. Bio */}
                <RevealSection className="glass p-4 sm:p-5 space-y-3">
                    <h2 className="text-black dark:text-white text-xl font-bold">About</h2>
                    <BlurbSection
                        key={artist.bio ?? ""}
                        artistName={artist.name ?? ""}
                        artistId={artist.id}
                        initialBio={artist.bio ?? null}
                    />
                </RevealSection>

                {/* 4. Ask About Artist (AI Q&A) */}
                <RevealSection className="glass p-4 sm:p-5 space-y-3">
                    <h2 className="text-black dark:text-white text-xl font-bold break-words">Ask About {artist.name}</h2>
                    <AskAboutArtist artistId={artist.id} artistName={artist.name ?? "this artist"} />
                </RevealSection>

                {/* 5. Social Links (icon grid) */}
                <RevealSection className="glass p-4 sm:p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 className="text-black dark:text-white text-xl font-bold">Social Links</h2>
                        <AddArtistData
                            artist={artist}
                            spotifyImg={platformImage ?? ""}
                            availableLinks={urlMapList}
                            isOpenOnLoad={false}
                            directEdit={directEditLinks}
                            autoApprove={autoApproveLinkSubmissions}
                        />
                    </div>
                    <ArtistLinksGrid isMonetized={false} artist={artist} availableLinks={urlMapList} canEdit={canEdit} />
                </RevealSection>

                {/* 6. Support the Artist (icon grid) */}
                <RevealSection className="glass p-4 sm:p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 className="text-black dark:text-white text-xl font-bold">Support the Artist</h2>
                        <AddArtistData
                            artist={artist}
                            spotifyImg={platformImage ?? ""}
                            availableLinks={urlMapList}
                            isOpenOnLoad={false}
                            directEdit={directEditLinks}
                            autoApprove={autoApproveLinkSubmissions}
                        />
                    </div>
                    <ArtistLinksGrid isMonetized={true} artist={artist} availableLinks={urlMapList} canEdit={canEdit} />
                </RevealSection>

                {/* 7. Press & Features (vault sources) */}
                <VaultSection artistId={artist.id} pendingSources={pendingSources} approvedSources={approvedSources} />

            </div>
            </EditModeProvider>
            <SeoArtistLinks artist={artist} />
        </>
    );
}
