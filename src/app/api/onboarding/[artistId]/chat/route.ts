import { NextResponse } from "next/server";
import { getServerAuthSession } from "@/server/auth";
import { getDevSession } from "@/server/utils/dev-auth";
import { canEditArtist } from "@/server/utils/artistEditAuth";
import { runOnboardingTurn, type ClientTurn } from "@/server/utils/onboarding/turnHandlers";

export const dynamic = "force-dynamic";
// One POST = ONE chat turn (spec §4). The publish-step generation turn runs two
// ungrounded Gemini calls (~8s each measured on artistBio) — comfortably inside
// 60s, but the deadline below guarantees we close before Vercel kills us.
export const maxDuration = 60;
const TURN_DEADLINE_MS = 55_000;

export async function POST(request: Request, { params }: { params: Promise<{ artistId: string }> }) {
    const { artistId } = await params;

    const session = await getServerAuthSession() ?? await getDevSession();
    if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    if (!(await canEditArtist(session.user.id, artistId))) {
        return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    let turn: ClientTurn;
    try {
        turn = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    if (!turn || typeof turn !== "object" || typeof (turn as { type?: unknown }).type !== "string") {
        return NextResponse.json({ error: "Invalid turn" }, { status: 400 });
    }
    // Reject oversized batches before they reach the handler loops (decisions/
    // addedLinks/addedUrls are all client-controlled arrays).
    const MAX_TURN_ARRAY_LEN = 100;
    const fieldTooLong = (key: string) => {
        const value = (turn as Record<string, unknown>)[key];
        return Array.isArray(value) && value.length > MAX_TURN_ARRAY_LEN;
    };
    if (fieldTooLong("decisions") || fieldTooLong("addedLinks") || fieldTooLong("addedUrls")) {
        return NextResponse.json({ error: "Too many items in one turn" }, { status: 400 });
    }

    const encoder = new TextEncoder();
    const startedAt = Date.now();
    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            // Both enqueue() and close() throw once the client has disconnected
            // (the reader was cancelled) — guard both so an abandoned stream
            // never produces an unhandled rejection.
            const send = (event: unknown) => {
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                } catch (e) {
                    console.error("[onboarding/chat] send after stream closed:", e);
                }
            };
            try {
                for await (const event of runOnboardingTurn(artistId, turn)) {
                    send(event);
                    if (Date.now() - startedAt > TURN_DEADLINE_MS) {
                        // Checkpoint stays unconfirmed — derived state resumes next turn (spec §9).
                        send({ kind: "error", message: "That took longer than expected — you can pick up right where you left off." });
                        break;
                    }
                }
            } catch (e) {
                console.error("[onboarding/chat] Turn error:", e);
                send({ kind: "error", message: "Something went wrong on our end — try that again." });
            } finally {
                try {
                    controller.close();
                } catch (e) {
                    console.error("[onboarding/chat] close after stream closed:", e);
                }
            }
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
        },
    });
}
