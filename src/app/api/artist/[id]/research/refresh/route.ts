/**
 * "Look again" — the artist asking us to read what they have posted since.
 *
 * INCREMENTAL, not a re-run. A full re-read of a three-hundred-post feed is
 * about seven minutes and a Gemini bill, and nearly all of it is re-reading
 * captions we already understood. `ensureRecentSocialPosts` only fetches posts
 * newer than the most recent one stored, so for an artist who posted twice
 * since last time this is seconds of work.
 *
 * Rate limited per artist. A button this expensive next to a curious person is
 * a bad combination, and the honest answer to "again?" thirty seconds later is
 * "we already have those".
 */
import { canEditArtist } from "@/server/utils/artistEditAuth";
import { getServerAuthSession } from "@/server/auth";
import { requestArtistResearch } from "@/server/utils/researchRunner";
import { getResearchJobs, reopenResearchJob } from "@/server/utils/queries/researchJobQueries";

export const dynamic = "force-dynamic";

/** Long enough that the button cannot be leaned on, short enough that an
 *  artist who just posted something can see it land. */
const COOLDOWN_MS = 30 * 60 * 1000;

export async function POST(
    _req: Request,
    { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
    const { id } = await params;
    try {
        const session = await getServerAuthSession();
        const userId = session?.user?.id;
        if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
        if (!(await canEditArtist(userId, id))) {
            return Response.json({ error: "Not your artist" }, { status: 403 });
        }

        const jobs = await getResearchJobs(id);
        const live = jobs.find(j => j.status === "pending" || j.status === "running");
        if (live) {
            // Already working. Saying so is better than silently enqueuing
            // nothing and looking like the button did not do anything.
            return Response.json({
                ok: true,
                message: live.total
                    ? `Already reading your posts (${live.cursor}/${live.total}).`
                    : "Already reading your posts.",
            });
        }

        const lastFinished = jobs
            .map(j => Number(new Date(j.updatedAt ?? 0)))
            .filter(n => Number.isFinite(n) && n > 0)
            .sort((a, b) => b - a)[0] ?? 0;
        if (lastFinished && Date.now() - lastFinished < COOLDOWN_MS) {
            const mins = Math.ceil((COOLDOWN_MS - (Date.now() - lastFinished)) / 60000);
            return Response.json({
                ok: true,
                message: `We read your posts recently. Check back in about ${mins} minute${mins === 1 ? "" : "s"}.`,
            });
        }

        await reopenResearchJob(id, "social_ingest");
        await reopenResearchJob(id, "caption_extract");
        await requestArtistResearch(id, { force: true });

        return Response.json({
            ok: true,
            message: "Reading anything you've posted since last time — this page will fill in as it goes.",
        });
    } catch (e) {
        console.error("[research/refresh] Error:", e);
        return Response.json({ error: "Couldn't start that" }, { status: 500 });
    }
}
