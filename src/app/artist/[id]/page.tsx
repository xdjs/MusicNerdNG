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
import KnowledgeSection from "./_components/KnowledgeSection";
import YourWordsSection from "./_components/YourWordsSection";
import AskAboutArtist from "./_components/AskAboutArtist";
import RevealSection from "./_components/RevealSection";
import { getVaultSourcesByArtistId } from "@/server/utils/queries/dashboardQueries";
import AutoRefresh from "@/app/_components/AutoRefresh";
import type { Metadata } from "next";
import SeoArtistLinks from "./_components/SeoArtistLinks";
import ArtistJsonLd from "./_components/ArtistJsonLd";
import OfficialSiteLinks from "./_components/OfficialSiteLinks";
import OnboardingGate from "./_components/onboarding/OnboardingGate";
import ProfileTour from "./_components/onboarding/ProfileTour";
import { getOnboardingState } from "@/server/utils/queries/onboardingQueries";
import { buildCanonicalArtistUrl, parseSupportedArtistUrl } from "@/lib/artistProfileUrl";
import { isRealBio } from "@/lib/bioConstants";

type ArtistProfileProps = {
    params: Promise<{ id: string }>;
    searchParams?: Promise<{ addLink?: string | string[] }>;
}

function getAddLinkPrefill(addLink: string | string[] | undefined): string | undefined {
    if (typeof addLink !== "string") return undefined;

    const parsed = parseSupportedArtistUrl(addLink);
    return parsed ? buildCanonicalArtistUrl(parsed.platform, parsed.id) ?? undefined : undefined;
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

    // The artist's own About, when one has been written, rather than the
    // template. "Discover X's social links and streaming profiles on Music
    // Nerd" is the same sentence on every page in the directory: it is what a
    // search result shows, what a shared link previews as, and what an
    // assistant quotes, and it says nothing about the artist. The About is
    // right there and is the best 160 characters we have.
    const description = artist.bio && isRealBio(artist.bio)
        ? summarize(artist.bio)
        : `Discover ${artistName}'s social links and streaming profiles on Music Nerd.`;
    const pageUrl = `https://www.musicnerd.xyz/artist/${id}`;

    return {
        title: `${artistName} | Music Nerd`,
        description,
        alternates: { canonical: pageUrl },
        openGraph: {
            type: "profile",
            title: `${artistName} | Music Nerd`,
            description,
            url: pageUrl,
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
            description,
            images: [imageUrl],
        },
    };
}

/** A description is a couple of sentences, not a bio. Cut on a sentence
 *  boundary when there is one in range; a description that ends mid-clause
 *  reads as broken rather than truncated. */
function summarize(bio: string, max = 300): string {
    const text = bio.trim().replace(/\s+/g, " ");
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    return lastStop > max * 0.5 ? cut.slice(0, lastStop + 1) : `${cut.trimEnd()}…`;
}

export default async function ArtistProfile({ params, searchParams }: ArtistProfileProps) {
    const { id } = await params;
    const resolvedSearchParams = searchParams ? await searchParams : undefined;
    const addLinkPrefill = getAddLinkPrefill(resolvedSearchParams?.addLink);
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

    // Onboarding state costs a query — computed ONLY for the approved claimant.
    // getOnboardingState returns null when the confirmed-steps read FAILED (fail
    // CLOSED — spec C1), not just when there's nothing to show. The `onboardingState
    // && ...` gate below already renders neither the takeover nor the banner in
    // that case — never fall back to a default/guessed state here.
    const onboardingState = isClaimedByUser ? await getOnboardingState(id) : null;

    const pendingSources = canEdit ? pendingSourcesRaw : [];

    const imageUrl = artist.customImage || platformImage || "/default_pfp_pink.png";

    return (
        <>
            <EditModeProvider canEdit={canEdit}>
            <AutoRefresh showLoading={false} />
            <div className="w-full max-w-[800px] mx-auto px-4 py-5 space-y-6">

                {/* Gated on onboarding being COMPLETE, which is the only state in
                    which a post-build tour makes sense. Without this, a stale
                    "pending" flag from an earlier session started the tour while
                    the build was still running — the artist watched a card say
                    "we drafted your About" over an About that did not exist yet.
                    Note this is the INVERSE of the gate on OnboardingGate below:
                    once complete it stays complete, so unlike that one this
                    cannot be unmounted out from under the tour. */}
                {isClaimedByUser && onboardingState?.complete && <ProfileTour artistId={artist.id} />}

                {onboardingState && !onboardingState.complete && (
                    <OnboardingGate
                        artistId={artist.id}
                        artistName={artist.name ?? "your profile"}
                        currentStep={onboardingState.currentStep}
                    />
                )}

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
                <RevealSection id="mn-about" className="glass p-4 sm:p-5 space-y-3">
                    <h2 className="text-black dark:text-white text-xl font-bold">About</h2>
                    <BlurbSection
                        key={artist.bio ?? ""}
                        artistName={artist.name ?? ""}
                        artistId={artist.id}
                        initialBio={artist.bio ?? null}
                    />
                </RevealSection>

                {/* 4. Ask About Artist (AI Q&A) */}
                <RevealSection id="mn-ask" className="glass p-4 sm:p-5 space-y-3">
                    <h2 className="text-black dark:text-white text-xl font-bold break-words">Ask About {artist.name}</h2>
                    <AskAboutArtist artistId={artist.id} artistName={artist.name ?? "this artist"} />
                </RevealSection>

                {/* 5. Links (icon grid) */}
                <RevealSection id="mn-links" className="glass p-4 sm:p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 className="text-black dark:text-white text-xl font-bold">Links</h2>
                        <AddArtistData
                            artist={artist}
                            spotifyImg={platformImage ?? ""}
                            availableLinks={urlMapList}
                            isOpenOnLoad={!!addLinkPrefill}
                            prefillUrl={addLinkPrefill}
                            directEdit={directEditLinks}
                            autoApprove={autoApproveLinkSubmissions}
                        />
                    </div>
                    <ArtistLinksGrid isMonetized={false} artist={artist} availableLinks={urlMapList} canEdit={canEdit} />
                    <OfficialSiteLinks sources={approvedSources} />
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
                <div id="mn-sources">
                <VaultSection artistId={artist.id} pendingSources={pendingSources} approvedSources={approvedSources} />
                </div>

                {/* 8. What we know — the knowledge document, as correctable claims.
                    Sits AFTER the sources deliberately, because every claim in it
                    points back at one of them. The component owns its own gating
                    (owner AND editing) the way VaultSection does, so it renders
                    nothing at all the rest of the time. */}
                <div id="mn-knowledge">
                    <KnowledgeSection artistId={artist.id} />
                    <YourWordsSection artistId={artist.id} />
                </div>

            </div>
            </EditModeProvider>
            <SeoArtistLinks artist={artist} />
            <ArtistJsonLd
                artist={artist}
                imageUrl={imageUrl}
                pageUrl={`https://www.musicnerd.xyz/artist/${id}`}
            />
        </>
    );
}
