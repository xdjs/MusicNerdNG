"use client";

import { useCallback, useRef, useState } from "react";
import type { ProfileCandidate, DocSource } from "./StepCards";

export type ChatItem = {
    id: string;
    kind: "bot" | "user" | "progress" | "step" | "draft" | "complete" | "error" | "candidates";
    text?: string;
    step?: string;
    payload?: unknown;
    doc?: string;
    about?: string;
    // The numbered citation manifest for this draft's [n] markers — undefined
    // for a stale server that predates citations, empty when nothing was
    // citable. Held here (not on AboutDraftCard's onPublish payload, which is
    // locked to exactly {doc, about} by existing tests) and threaded into the
    // actual publish turn by OnboardingChat.tsx.
    sources?: DocSource[];
    done?: boolean;
    // Live-accumulated discovered profiles for a "candidates" item — grows as
    // `candidate` SSE events arrive, one at a time, ahead of the terminal
    // `step` event (see the `push` reconciliation logic below).
    candidates?: ProfileCandidate[];
    // Set only on "progress" items that belong to a collapsible batch (e.g.
    // the profiles step's per-platform search) — see the `push` reconciliation
    // logic below. Undefined for every standalone progress chip.
    group?: string;
};

export type ClientTurnShape =
    | { type: "open" }
    | { type: "confirm_profiles"; addedLinks: { url: string }[]; removedSiteNames: string[] }
    | { type: "vault_review"; decisions: { sourceId: string; status: "approved" | "rejected" }[]; addedUrls: string[] }
    // `question` round-trips the question TEXT the client was shown — needed
    // server-side to store a grounded (non-static) question's wording; see
    // resolveInterviewQuestionText in turnHandlers.ts.
    | { type: "interview_answer"; questionKey: string; answer: string | null; question?: string }
    | { type: "publish"; doc: string; about: string; sources?: DocSource[] };

/** Text shown as the user's own bubble for a given turn (null = no user bubble). */
function userEcho(turn: ClientTurnShape): string | null {
    switch (turn.type) {
        case "confirm_profiles": return "Looks good — that's me.";
        case "vault_review": return "Done sorting those.";
        case "interview_answer": return turn.answer ?? "Skip that one.";
        case "publish": return "Publish it 🚀";
        default: return null;
    }
}

export function useOnboardingChat(artistId: string) {
    const [items, setItems] = useState<ChatItem[]>([]);
    const [busy, setBusy] = useState(false);
    const counter = useRef(0);

    const push = useCallback((item: Omit<ChatItem, "id">) => {
        counter.current += 1;
        const id = `c${counter.current}`;
        setItems(prev => {
            // progress events update their existing chip in place. Grouped
            // events (item.group set — currently just the profiles step's
            // per-platform search) match by group id, since their `text`
            // deliberately changes on every update (a climbing "Searching N
            // platforms…" count) — matching by group instead of text is what
            // collapses every "searching" event in the batch onto the SAME
            // chip instead of spawning a new one whenever the label changes.
            // Standalone progress chips keep matching by label text, as before.
            if (item.kind === "progress") {
                const idx = item.group
                    ? prev.findIndex(p => p.kind === "progress" && p.group === item.group)
                    : prev.findIndex(p => p.kind === "progress" && p.text === item.text);
                if (idx >= 0) {
                    const next = [...prev];
                    next[idx] = { ...next[idx], text: item.text, done: item.done };
                    return next;
                }
            }
            // A `candidate` SSE event arrives here as a one-item "candidates"
            // push — accumulate into the single live-discovery item in place
            // (like progress chips above) instead of spawning a new bubble
            // per profile found.
            if (item.kind === "candidates") {
                const idx = prev.findIndex(p => p.kind === "candidates");
                if (idx >= 0) {
                    const next = [...prev];
                    const existing = next[idx].candidates ?? [];
                    const incoming = item.candidates ?? [];
                    const merged = [...existing];
                    for (const c of incoming) {
                        if (!merged.some(m => m.siteName === c.siteName)) merged.push(c);
                    }
                    next[idx] = { ...next[idx], candidates: merged };
                    return next;
                }
            }
            // The terminal `step` event for the profiles step carries the
            // complete, authoritative candidate list — drop the transient
            // live-discovery item so it isn't shown twice (reconcile, don't
            // duplicate). The candidates the artist already watched arrive
            // live now render instead as the opt-in section of ProfilesCard.
            if (item.kind === "step" && item.step === "profiles") {
                const withoutLiveCandidates = prev.filter(p => p.kind !== "candidates");
                return [...withoutLiveCandidates, { id, ...item }];
            }
            return [...prev, { id, ...item }];
        });
    }, []);

    const sendTurn = useCallback(async (turn: ClientTurnShape) => {
        if (busy) return;
        setBusy(true);
        const echo = userEcho(turn);
        if (echo) push({ kind: "user", text: echo });
        // next dev has no server-side deadline enforcement (maxDuration is
        // Vercel-only) — without a client ceiling, a hung fetch leaves `busy`
        // true forever and every card disabled. Abort forces the catch block
        // below to run so `finally` always clears it.
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 65_000);
        try {
            const res = await fetch(`/api/onboarding/${artistId}/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(turn),
                signal: controller.signal,
            });
            if (!res.ok || !res.body) {
                // Non-SSE failure (401/403/429/500) comes back as JSON
                const data = await res.json().catch(() => null);
                push({ kind: "error", text: data?.error ?? "Something went wrong — try again in a moment." });
                return;
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            // A stream that ends without ever reaching a terminal frame (step,
            // draft, complete, or error) would otherwise flip `busy` false with
            // no interactive item and no message — a silent dead end.
            let receivedTerminalFrame = false;
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let sep: number;
                while ((sep = buffer.indexOf("\n\n")) !== -1) {
                    const line = buffer.slice(0, sep).trim();
                    buffer = buffer.slice(sep + 2);
                    if (!line.startsWith("data: ")) continue;
                    try {
                        const event = JSON.parse(line.slice(6));
                        switch (event.kind) {
                            case "chat": push({ kind: "bot", text: event.text }); break;
                            case "progress": push({ kind: "progress", text: event.label, done: event.done, group: event.group }); break;
                            // Additive live feedback, not a terminal frame — the
                            // terminal `step` event still carries the complete
                            // candidate list (see the reconciliation logic in
                            // `push` above), so a stream that ends after only
                            // `candidate` events with no `step`/`draft`/`complete`/
                            // `error` still correctly falls into the
                            // no-terminal-frame error path below.
                            case "candidate": push({ kind: "candidates", candidates: [event.profile] }); break;
                            case "step": push({ kind: "step", step: event.step, payload: event.payload }); receivedTerminalFrame = true; break;
                            case "draft": push({ kind: "draft", doc: event.doc, about: event.about, sources: event.sources }); receivedTerminalFrame = true; break;
                            case "complete": push({ kind: "complete" }); receivedTerminalFrame = true; break;
                            case "error": push({ kind: "error", text: event.message }); receivedTerminalFrame = true; break;
                        }
                    } catch {
                        // malformed line — skip
                    }
                }
            }
            if (!receivedTerminalFrame) {
                push({ kind: "error", text: "Something went wrong — try again in a moment." });
            }
        } catch (e) {
            console.error("[useOnboardingChat] stream error:", e);
            push({ kind: "error", text: "Connection dropped — your progress is saved, just try again." });
        } finally {
            clearTimeout(timeoutId);
            setBusy(false);
        }
    }, [artistId, busy, push]);

    return { items, busy, sendTurn };
}
