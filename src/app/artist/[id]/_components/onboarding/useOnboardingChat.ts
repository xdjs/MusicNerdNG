"use client";

import { useCallback, useRef, useState } from "react";

export type ChatItem = {
    id: string;
    kind: "bot" | "user" | "progress" | "step" | "draft" | "complete" | "error";
    text?: string;
    step?: string;
    payload?: unknown;
    doc?: string;
    about?: string;
    done?: boolean;
};

export type ClientTurnShape =
    | { type: "open" }
    | { type: "confirm_profiles"; addedLinks: { url: string }[]; removedSiteNames: string[] }
    | { type: "vault_review"; decisions: { sourceId: string; status: "approved" | "rejected" }[]; addedUrls: string[] }
    | { type: "interview_answer"; questionKey: string; answer: string | null }
    | { type: "publish"; doc: string; about: string };

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
            // progress events update their existing chip in place (label match)
            if (item.kind === "progress") {
                const idx = prev.findIndex(p => p.kind === "progress" && p.text === item.text);
                if (idx >= 0) {
                    const next = [...prev];
                    next[idx] = { ...next[idx], done: item.done };
                    return next;
                }
            }
            return [...prev, { id, ...item }];
        });
    }, []);

    const sendTurn = useCallback(async (turn: ClientTurnShape) => {
        if (busy) return;
        setBusy(true);
        const echo = userEcho(turn);
        if (echo) push({ kind: "user", text: echo });
        try {
            const res = await fetch(`/api/onboarding/${artistId}/chat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(turn),
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
                            case "progress": push({ kind: "progress", text: event.label, done: event.done }); break;
                            case "step": push({ kind: "step", step: event.step, payload: event.payload }); break;
                            case "draft": push({ kind: "draft", doc: event.doc, about: event.about }); break;
                            case "complete": push({ kind: "complete" }); break;
                            case "error": push({ kind: "error", text: event.message }); break;
                        }
                    } catch {
                        // malformed line — skip
                    }
                }
            }
        } catch (e) {
            console.error("[useOnboardingChat] stream error:", e);
            push({ kind: "error", text: "Connection dropped — your progress is saved, just try again." });
        } finally {
            setBusy(false);
        }
    }, [artistId, busy, push]);

    return { items, busy, sendTurn };
}
