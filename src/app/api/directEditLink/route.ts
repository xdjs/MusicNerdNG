import { requireAuth } from "@/lib/auth-helpers";
import { canEditArtist } from "@/server/utils/artistEditAuth";
import { notifyDiscordOfArtistLinkAdded } from "@/server/utils/artistLinkDiscordNotifier";
import { setArtistLink, clearArtistLink } from "@/server/utils/artistLinkService";
import { getUserById } from "@/server/utils/queries/userQueries";
import { extractArtistId } from "@/server/utils/services";
import { LINK_NOT_SUPPORTED_LONG } from "@/lib/linkSubmissionMessages";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
    const start = performance.now();
    try {
        const authResult = await requireAuth();
        if (!authResult.authenticated) return authResult.response;

        const { artistId, action, url, siteName } = await req.json();

        if (!artistId || !action) {
            return Response.json({ error: "artistId and action are required" }, { status: 400 });
        }

        if (action !== "set" && action !== "clear") {
            return Response.json({ error: "action must be 'set' or 'clear'" }, { status: 400 });
        }

        // Authorization: admin can edit any artist, claimed artist can edit own profile only
        if (!(await canEditArtist(authResult.userId, artistId))) {
            return Response.json({ error: "Not authorized for this artist" }, { status: 403 });
        }

        if (action === "set") {
            if (!url) {
                return Response.json({ error: "url is required for set action" }, { status: 400 });
            }

            const extracted = await extractArtistId(url);
            if (!extracted?.siteName || !extracted?.id) {
                return Response.json({ error: LINK_NOT_SUPPORTED_LONG }, { status: 400 });
            }

            const user = await getUserById(authResult.userId);
            const { oldValue, artistName } = await setArtistLink(artistId, extracted.siteName, extracted.id);
            if (oldValue !== extracted.id) {
                await notifyDiscordOfArtistLinkAdded({
                    user: user ?? {},
                    artistName: artistName ?? artistId,
                    platformName: extracted.cardPlatformName ?? extracted.siteName,
                    platformId: extracted.id,
                    submittedUrl: url,
                });
            }
            return Response.json({ success: true, siteName: extracted.siteName, platformName: extracted.cardPlatformName });
        }

        if (action === "clear") {
            if (!siteName) {
                return Response.json({ error: "siteName is required for clear action" }, { status: 400 });
            }

            await clearArtistLink(artistId, siteName);
            return Response.json({ success: true });
        }

        return Response.json({ error: "Invalid action" }, { status: 400 });
    } catch (error) {
        console.error("[directEditLink] Error:", error);
        return Response.json({ error: "Internal server error" }, { status: 500 });
    } finally {
        console.debug(`[directEditLink] POST took ${performance.now() - start}ms`);
    }
}
