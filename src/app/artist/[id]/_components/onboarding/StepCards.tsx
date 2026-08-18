"use client";

import { useState } from "react";

// ---------- Profiles: accepted-by-default. Leaving a card as-is IS confirmation. ----------

type ProfilesPayload = {
    artistName: string;
    links: { siteName: string; value: string }[];
    enrichment: { platform: string; followerCount: number | null; imageUrl: string | null } | null;
};

export function ProfilesCard({ payload, onConfirm, disabled }: {
    payload: ProfilesPayload;
    onConfirm: (r: { addedLinks: { url: string }[]; removedSiteNames: string[] }) => void;
    disabled: boolean;
}) {
    const [removed, setRemoved] = useState<Set<string>>(new Set());
    const [added, setAdded] = useState<string[]>([]);
    const [draft, setDraft] = useState("");

    const toggleRemoved = (siteName: string) => {
        setRemoved(prev => {
            const next = new Set(prev);
            if (next.has(siteName)) next.delete(siteName); else next.add(siteName);
            return next;
        });
    };

    const fmtFollowers = (n: number) =>
        n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}K` : `${n}`;

    return (
        <div className="glass rounded-xl p-4 space-y-2 w-full">
            {payload.links.map(link => (
                <div
                    key={link.siteName}
                    className={`flex items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 ${removed.has(link.siteName) ? "opacity-40 line-through" : ""}`}
                >
                    <div className="min-w-0">
                        <span className="font-medium capitalize">{link.siteName}</span>
                        <span className="text-sm text-gray-500 ml-2 break-all">{link.value}</span>
                        {payload.enrichment && link.siteName === payload.enrichment.platform && payload.enrichment.followerCount != null && (
                            <span className="text-xs text-gray-400 ml-2">{fmtFollowers(payload.enrichment.followerCount)} fans</span>
                        )}
                    </div>
                    <button
                        aria-label={`remove ${link.siteName}`}
                        onClick={() => toggleRemoved(link.siteName)}
                        disabled={disabled}
                        className="text-gray-400 hover:text-red-500 px-2"
                    >
                        ✕
                    </button>
                </div>
            ))}
            {added.map(url => (
                <div key={url} className="text-sm text-green-600 dark:text-green-400 px-3">+ {url}</div>
            ))}
            <div className="flex gap-2 pt-1">
                <input
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    placeholder="Paste a link we missed…"
                    disabled={disabled}
                    className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 text-sm"
                />
                <button
                    onClick={() => { if (draft.trim()) { setAdded(prev => [...prev, draft.trim()]); setDraft(""); } }}
                    disabled={disabled || !draft.trim()}
                    className="text-sm px-3 py-2 rounded-lg border border-pink-500 text-pink-500 disabled:opacity-40"
                >
                    Add
                </button>
            </div>
            <button
                onClick={() => onConfirm({ addedLinks: added.map(url => ({ url })), removedSiteNames: [...removed] })}
                disabled={disabled}
                className="w-full bg-pink-500 hover:bg-pink-600 text-white font-semibold py-2.5 rounded-lg mt-1 disabled:opacity-50"
            >
                Looks good, continue
            </button>
        </div>
    );
}

// ---------- Vault: keep-by-default ----------

type VaultPayload = { sources: { id: string; title: string | null; url: string; snippet: string | null }[] };

export function VaultCard({ payload, onConfirm, disabled }: {
    payload: VaultPayload;
    onConfirm: (r: { decisions: { sourceId: string; status: "approved" | "rejected" }[]; addedUrls: string[] }) => void;
    disabled: boolean;
}) {
    const [skipped, setSkipped] = useState<Set<string>>(new Set());
    const [added, setAdded] = useState<string[]>([]);
    const [draft, setDraft] = useState("");

    const toggle = (id: string) => setSkipped(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const submit = () => onConfirm({
        decisions: payload.sources.map(s => ({
            sourceId: s.id,
            status: skipped.has(s.id) ? "rejected" as const : "approved" as const,
        })),
        addedUrls: added,
    });

    return (
        <div className="glass rounded-xl p-4 space-y-2 w-full">
            {payload.sources.map(s => (
                <div
                    key={s.id}
                    className={`rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 flex items-start justify-between gap-2 ${skipped.has(s.id) ? "opacity-40" : ""}`}
                >
                    <div className="min-w-0">
                        <p className="font-medium truncate">{s.title ?? s.url}</p>
                        {s.snippet && <p className="text-sm text-gray-500 line-clamp-2">{s.snippet}</p>}
                    </div>
                    <button
                        aria-label={`${skipped.has(s.id) ? "keep" : "skip"} ${s.title ?? s.url}`}
                        onClick={() => toggle(s.id)}
                        disabled={disabled}
                        className="text-sm whitespace-nowrap px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600"
                    >
                        {skipped.has(s.id) ? "keep" : "skip"}
                    </button>
                </div>
            ))}
            {added.map(url => (
                <div key={url} className="text-sm text-green-600 dark:text-green-400 px-3">+ {url}</div>
            ))}
            <div className="flex gap-2 pt-1">
                <input
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    placeholder="Paste a link — press, an interview, your site…"
                    disabled={disabled}
                    className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 text-sm"
                />
                <button
                    onClick={() => { if (draft.trim()) { setAdded(prev => [...prev, draft.trim()]); setDraft(""); } }}
                    disabled={disabled || !draft.trim()}
                    className="text-sm px-3 py-2 rounded-lg border border-pink-500 text-pink-500 disabled:opacity-40"
                >
                    Add
                </button>
            </div>
            <button
                onClick={submit}
                disabled={disabled}
                className="w-full bg-pink-500 hover:bg-pink-600 text-white font-semibold py-2.5 rounded-lg mt-1 disabled:opacity-50"
            >
                {payload.sources.length > 0 ? "Keep these, continue" : "Continue"}
            </button>
        </div>
    );
}

// ---------- Interview ----------

type InterviewPayload = { questionKey: string; question: string; number: number; total: number };

export function InterviewInput({ payload, onAnswer, disabled }: {
    payload: InterviewPayload;
    onAnswer: (r: { questionKey: string; answer: string | null }) => void;
    disabled: boolean;
}) {
    const [draft, setDraft] = useState("");
    return (
        <div className="w-full space-y-2">
            <p className="text-xs text-gray-400">Question {payload.number} of {payload.total} — all optional</p>
            <div className="flex gap-2">
                <input
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && draft.trim()) onAnswer({ questionKey: payload.questionKey, answer: draft.trim() }); }}
                    placeholder="Type your answer…"
                    disabled={disabled}
                    className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2"
                />
                <button
                    onClick={() => onAnswer({ questionKey: payload.questionKey, answer: draft.trim() })}
                    disabled={disabled || !draft.trim()}
                    className="bg-pink-500 text-white font-semibold px-4 rounded-lg disabled:opacity-40"
                >
                    Send
                </button>
            </div>
            <button
                onClick={() => onAnswer({ questionKey: payload.questionKey, answer: null })}
                disabled={disabled}
                className="text-sm text-gray-500 underline"
            >
                Skip this one
            </button>
        </div>
    );
}

// ---------- About draft: show finished work, ask one yes/no ----------

export function AboutDraftCard({ doc, about, onPublish, disabled }: {
    doc: string;
    about: string;
    onPublish: (r: { doc: string; about: string }) => void;
    disabled: boolean;
}) {
    return (
        <div className="glass rounded-xl p-4 space-y-3 w-full">
            <h3 className="font-bold text-pink-500">Your About</h3>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{about}</p>
            <button
                onClick={() => onPublish({ doc, about })}
                disabled={disabled}
                className="w-full bg-pink-500 hover:bg-pink-600 text-white font-semibold py-2.5 rounded-lg disabled:opacity-50"
            >
                Publish this
            </button>
            <p className="text-xs text-gray-400">
                This also saves your artist doc — it powers your page&apos;s Q&amp;A and fun facts.
            </p>
        </div>
    );
}
