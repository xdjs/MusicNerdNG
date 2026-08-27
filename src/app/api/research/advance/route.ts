/**
 * One slice of research work, in its own invocation.
 *
 * The point of this route is the budget. `after()` on an onboarding turn shares
 * that turn's remaining maxDuration, so a chat turn that spent fifty seconds
 * left ten for a job that needs minutes — which is why every artist we had not
 * pre-warmed by hand ended up with a document built from an empty credits
 * table. Here the slice gets the whole allowance.
 *
 * Called by:
 *   - the onboarding client, while the artist is reading the vault step. They
 *     spend minutes there, and each call is a full-budget invocation happening
 *     while somebody is actually watching.
 *   - the artist, from the "look again" button in edit mode.
 *   - a scheduler, for artists nobody is watching.
 *
 * Safe to call concurrently: the work is claimed atomically with a lease, so
 * two callers cannot take the same job, and a caller the platform kills frees
 * its job instead of wedging it.
 */
import { advanceResearch } from "@/server/utils/researchRunner";

export const dynamic = "force-dynamic";
/** The whole point. A slice gets its own allowance rather than a chat turn's
 *  leftovers. 60 is the ceiling on the current plan. */
export const maxDuration = 60;

/** Held back so the response is sent rather than the platform cutting us off
 *  mid-write. */
const RESPONSE_RESERVE_MS = 4_000;

export async function POST(req: Request): Promise<Response> {
    const started = Date.now();
    try {
        const body = await req.json().catch(() => ({}));
        const artistId = typeof body?.artistId === "string" ? body.artistId : undefined;

        const result = await advanceResearch({
            budgetMs: maxDuration * 1000 - RESPONSE_RESERVE_MS,
            artistId,
        });

        console.debug(`[research/advance] ${JSON.stringify(result)} in ${Date.now() - started}ms`);
        return Response.json(result);
    } catch (e) {
        console.error("[research/advance] Error:", e);
        // Deliberately a 200 with ran:false. This is a background worker
        // endpoint, and the callers are a browser poll and a scheduler; a 500
        // teaches them to back off from work that is fine.
        return Response.json({ ran: false, error: "advance failed" });
    }
}
