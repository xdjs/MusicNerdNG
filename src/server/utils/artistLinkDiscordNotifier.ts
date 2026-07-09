import { sendDiscordMessage } from "@/server/utils/queries/discord";
import { getUserDisplayName } from "@/server/utils/queries/userQueries";

type DiscordUser = Parameters<typeof getUserDisplayName>[0];

type ArtistLinkAddedNotification = {
    user: DiscordUser;
    artistName: string;
    platformName: string;
    platformId: string;
    submittedUrl: string;
    createdAt?: string;
};

export async function notifyDiscordOfArtistLinkAdded({
    user,
    artistName,
    platformName,
    platformId,
    submittedUrl,
    createdAt = new Date().toISOString(),
}: ArtistLinkAddedNotification) {
    await sendDiscordMessage(
        `${getUserDisplayName(user)} added ${artistName}'s ${platformName}: ${platformId} (Submitted URL: ${submittedUrl}) ${createdAt}`
    );
}
