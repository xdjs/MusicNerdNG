"use client";

import { useCallback, useContext, useEffect, useState } from "react";
import { Check, Pencil, X, ExternalLink, Undo2, Loader2, RefreshCw, Download } from "lucide-react";
import { EditModeContext } from "@/app/_components/EditModeContext";
import RevealSection from "./RevealSection";
import { useResearchPump } from "./onboarding/useResearchPump";
import { getKnowledgeDoc, correctDocClaim, undoDocCorrection } from "@/app/actions/dashboardActions";
import { parseDocClaims, countClaims, claimKey, type DocSection } from "@/lib/docClaims";

type DocSource = { id: number; kind: string; label?: string; url?: string; publishedAt?: string | null };
type Correction = { id: string; claim: string; correction: string | null; kind: string };

/** "VoyageMIA · 2019" — the host is what an artist recognises, and the year is
 *  usually why a claim reads stale. */
function sourceLabel(s: DocSource): string {
    // A PRESS source is best identified by where it ran — "rvamag · 2026" says
    // more than the headline would in a pill. A SOCIAL source is not: every one
    // of them is on instagram.com, so the hostname reduces the artist's own
    // words, their self-credits and their track credits all to the single word
    // "instagram". Pete, looking at a document citing nineteen separate posts
    // of his: "in my knowledge doc section I see nothing sourced from instagram
    // except for one thing." There was one PILL. SourcePills dedupes by label,
    // so nineteen sources with the same label collapse into one.
    //
    // The descriptive label is the thing worth showing there: "Their own words
    // — why he believes in Subvert" is what that citation actually is.
    if (s.kind === "social" && s.label) return s.label;

    let host = "";
    try {
        host = s.url ? new URL(s.url).hostname.replace(/^www\./, "").split(".")[0] : "";
    } catch { /* not a URL */ }
    const name = host || s.label || s.kind;
    const year = s.publishedAt?.slice(0, 4);
    return year ? `${name} · ${year}` : name;
}

/** Pills carry a full sentence for social sources, so they need trimming for
 *  display without losing which post they point at. */
function pillText(label: string): string {
    const clipped = label.length > 64 ? `${label.slice(0, 61)}…` : label;
    return clipped;
}

function SourcePills({ ids, sources }: { ids: number[]; sources: DocSource[] }) {
    if (ids.length === 0) return null;
    // Two social sources can render the same label ("instagram, instagram"),
    // which tells the artist nothing and looks like a bug. One pill per label.
    const seen = new Set<string>();
    return (
        <div className="flex flex-wrap gap-1.5">
            {ids.map(id => {
                const s = sources.find(x => x.id === id);
                if (!s) return null;
                const label = sourceLabel(s);
                if (seen.has(label)) return null;
                seen.add(label);
                const inner = (
                    <>
                        {pillText(label)}
                        {s.url && <ExternalLink size={9} className="opacity-60" />}
                    </>
                );
                const cls = "inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-black/10 dark:border-white/15 text-gray-600 dark:text-gray-400 whitespace-nowrap";
                return s.url
                    ? <a key={id} href={s.url} target="_blank" rel="noopener noreferrer" className={`${cls} hover:border-pink-500/50 hover:text-pink-500 transition-colors`}>{inner}</a>
                    : <span key={id} className={cls}>{inner}</span>;
            })}
        </div>
    );
}

function ClaimRow({
    text,
    sourceIds,
    sources,
    correction,
    onCorrect,
    onUndo,
    busy,
}: {
    text: string;
    sourceIds: number[];
    sources: DocSource[];
    correction?: Correction;
    onCorrect: (claim: string, kind: "wrong" | "fix", fix?: string) => void;
    onUndo: (id: string) => void;
    busy: boolean;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");

    // A corrected claim stays visible with its correction shown, rather than
    // disappearing. An artist who fixes something needs to see that it took, and
    // needs a way back if they change their mind.
    if (correction) {
        return (
            <li className="flex items-start gap-3 py-2.5 group">
                <span className="flex-shrink-0 mt-0.5 w-5 h-5 rounded-full bg-pink-500/15 text-pink-500 flex items-center justify-center">
                    <Check size={12} />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm text-gray-400 dark:text-gray-500 line-through decoration-gray-400/50">{text}</p>
                    <p className="text-sm text-black dark:text-white">
                        {correction.kind === "fix"
                            ? correction.correction
                            : <span className="italic text-gray-500 dark:text-gray-400">Removed &mdash; you said this isn&apos;t you.</span>}
                    </p>
                </div>
                <button
                    onClick={() => onUndo(correction.id)}
                    disabled={busy}
                    className="flex-shrink-0 flex items-center gap-1 text-[11px] text-gray-500 hover:text-black dark:hover:text-white transition-colors disabled:opacity-40"
                >
                    <Undo2 size={11} /> Undo
                </button>
            </li>
        );
    }

    if (editing) {
        return (
            <li className="py-2.5 space-y-2">
                <p className="text-xs text-gray-500 dark:text-gray-400">Instead of: &ldquo;{text}&rdquo;</p>
                <textarea
                    autoFocus
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    rows={2}
                    placeholder="Say it the way it actually is."
                    className="w-full text-sm rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 text-black dark:text-white placeholder:text-gray-500 focus:outline-none focus:border-pink-500"
                />
                <div className="flex gap-2">
                    <button
                        onClick={() => { onCorrect(text, "fix", draft); setEditing(false); }}
                        disabled={busy || !draft.trim()}
                        className="text-xs px-3 py-1.5 rounded-lg bg-pink-500 hover:bg-pink-600 text-white font-medium transition-colors disabled:opacity-40"
                    >
                        Save
                    </button>
                    <button
                        onClick={() => { setEditing(false); setDraft(""); }}
                        className="text-xs px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/20 text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            </li>
        );
    }

    return (
        <li className="flex items-start gap-3 py-2.5 group">
            <span aria-hidden="true" className="flex-shrink-0 mt-2 w-1.5 h-1.5 rounded-full bg-pink-500/50" />
            <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-sm text-black dark:text-gray-100">{text}</p>
                <SourcePills ids={sourceIds} sources={sources} />
            </div>
            {/* Always reachable on touch, quiet on hover-capable pointers. */}
            <div className="flex-shrink-0 flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity">
                <button
                    onClick={() => { setDraft(text); setEditing(true); }}
                    disabled={busy}
                    title="Fix this"
                    className="p-1.5 rounded-lg text-gray-500 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors disabled:opacity-40"
                >
                    <Pencil size={13} />
                </button>
                <button
                    onClick={() => onCorrect(text, "wrong")}
                    disabled={busy}
                    title="Not me"
                    className="p-1.5 rounded-lg text-gray-500 hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                >
                    <X size={13} />
                </button>
            </div>
        </li>
    );
}

/**
 * What we know about this artist, and how they correct it.
 *
 * The knowledge document feeds the Ask section, the fun facts, and the bio
 * generator — and until now it had no surface at all. It was written once at
 * publish and was invisible and uneditable from then on, which meant a false
 * claim (a rival producer's credit, read off a marketplace directory listed
 * under the artist's name) could sit in it answering fan questions forever.
 *
 * Deliberately NOT a text editor on the document. Two reasons:
 *
 *  1. The document is REGENERATED whenever sources change (refreshArtistDoc), so
 *     anything typed into it would appear to save and then vanish days later.
 *     Corrections live in their own table and are re-applied on every rebuild.
 *  2. It is a machine-readable file with `##` headers and `[n]` markers. Pete:
 *     "don't want it to look like a markdown file for user." Showing it raw
 *     would be showing our internals and asking an artist to copy-edit them.
 *
 * So it renders as CLAIMS: one row per bullet or sentence, each with the source
 * it came from and its year, and two actions a person can answer honestly —
 * that's wrong, or here's what it really is.
 *
 * Owner-only AND edit-mode-only. This is working material about a person, never
 * something to serve to visitors, and it is not something the artist wants
 * sitting under their profile the rest of the time either — Pete: "it should
 * only appear to edit once artist hits edit." Same gate the vault already uses.
 * The server action re-checks ownership regardless of this.
 */
export default function KnowledgeSection({ artistId }: { artistId: string }) {
    const { isEditing, canEdit } = useContext(EditModeContext);
    const [sections, setSections] = useState<DocSection[]>([]);
    const [sources, setSources] = useState<DocSource[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const [refreshNote, setRefreshNote] = useState<string | null>(null);
    /** True while this artist has research queued or running.
     *
     *  The pump lives inside the onboarding chat, which the page stops
     *  rendering once onboarding is complete — so "Look again" on a finished
     *  profile enqueued a job and nothing ever ran it. This drives the same
     *  route from here, for as long as there is work. */
    const [pumping, setPumping] = useState(false);
    const [corrections, setCorrections] = useState<Correction[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasDoc, setHasDoc] = useState(false);

    const load = useCallback(async () => {
        const res = await getKnowledgeDoc(artistId);
        if (!res.success) { setError(res.error ?? "Could not load this."); setLoading(false); return; }
        setHasDoc(!!res.content);
        setSections(parseDocClaims(res.content ?? ""));
        setSources((res.sources as DocSource[]) ?? []);
        setCorrections(res.corrections ?? []);
        setLoading(false);
    }, [artistId]);

    // Only fetched once the artist is actually editing — otherwise every page
    // view pays for a server action whose result nobody is allowed to see.
    useEffect(() => {
        if (canEdit && isEditing) void load();
    }, [load, canEdit, isEditing]);

    // Keyed through claimKey, matching what the server stored. Comparing raw
    // display text desynced silently for any claim past MAX_CLAIM_CHARS.
    const correctionFor = (claim: string) => corrections.find(c => c.claim === claimKey(claim));

    const handleCorrect = async (claim: string, kind: "wrong" | "fix", fix?: string) => {
        setBusy(true);
        setError(null);
        // Optimistic: the rebuild behind this takes a few seconds, and an artist
        // who clicks "not me" should not sit watching an unchanged page.
        const key = claimKey(claim);
        const optimistic: Correction = { id: `pending-${key}`, claim: key, kind, correction: fix ?? null };
        setCorrections(prev => [...prev.filter(c => c.claim !== key), optimistic]);
        const res = await correctDocClaim(artistId, claim, kind, fix);
        if (!res.success) {
            setCorrections(prev => prev.filter(c => c.id !== optimistic.id));
            setError(res.error ?? "That didn't save.");
        } else {
            await load();
        }
        setBusy(false);
    };

    const handleUndo = async (id: string) => {
        setBusy(true);
        setError(null);
        const res = await undoDocCorrection(artistId, id);
        if (!res.success) setError(res.error ?? "That didn't undo.");
        await load();
        setBusy(false);
    };

    // Nothing else on this page calls the advance route, so without this the
    // button is a promise nobody keeps.
    useResearchPump(artistId, pumping);

    if (!canEdit || !isEditing) return null;

    /** Ask the researcher to look at anything posted since it last read the
     *  feed. Incremental by design: a full re-read of a three-hundred-post feed
     *  is about seven minutes and a Gemini bill, and almost all of it would be
     *  re-reading captions we already understood. */
    const handleLookAgain = async () => {
        setRefreshing(true);
        setError(null);
        try {
            const res = await fetch(`/api/artist/${artistId}/research/refresh`, { method: "POST" });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data?.error ?? "Couldn't start that. Try again in a bit.");
            } else {
                setRefreshNote(data?.message ?? "Reading your recent posts — this page will fill in as it goes.");
                setPumping(true);
            }
        } catch {
            setError("Couldn't start that. Try again in a bit.");
        }
        setRefreshing(false);
    };

    const shell = (children: React.ReactNode) => (
        <RevealSection className="glass p-4 sm:p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
                <h2 className="text-black dark:text-white text-xl font-bold">What we know about you</h2>
                {hasDoc && (
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            type="button"
                            onClick={handleLookAgain}
                            disabled={refreshing}
                            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-black/10 dark:border-white/15 text-gray-600 dark:text-gray-400 hover:border-black/25 dark:hover:border-white/30 disabled:opacity-50"
                            title="Look at anything you've posted since we last read your feed"
                        >
                            {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                            Look again
                        </button>
                        {/* Markdown, not .txt: same bytes, and this one renders
                          * and survives a paste into another model with its
                          * structure and its citations intact. The sources are
                          * resolved inside the file, so [7] still means
                          * something wherever it ends up. */}
                        <a
                            href={`/api/artist/${artistId}/knowledge-doc/export`}
                            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-black/10 dark:border-white/15 text-gray-600 dark:text-gray-400 hover:border-black/25 dark:hover:border-white/30"
                            title="Download as markdown, with sources — ready to hand to another AI"
                        >
                            <Download size={12} />
                            Download
                        </a>
                    </div>
                )}
            </div>
            {refreshNote && (
                <p className="text-xs text-gray-500 dark:text-gray-400">{refreshNote}</p>
            )}
            {children}
        </RevealSection>
    );

    if (loading) {
        return shell(
            <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                <Loader2 size={14} className="animate-spin" /> Loading what we know&hellip;
            </div>
        );
    }

    if (!hasDoc) {
        return shell(
            <p className="text-sm text-gray-500 dark:text-gray-400">
                Nothing here yet. This fills in once your page has been built from your sources.
            </p>
        );
    }

    const total = countClaims(sections);

    return shell(
        <div className="space-y-6">
            <p className="text-sm text-gray-600 dark:text-gray-300/80">
                {total} thing{total === 1 ? "" : "s"} we&apos;d tell someone who asked about you, and where each one came from.
                Fix anything that&apos;s off &mdash; your corrections stick, even when we find new sources.
            </p>

            {error && (
                <p className="text-sm text-red-500" role="alert">{error}</p>
            )}

            {sections.map(section => (
                <section key={section.header}>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
                        {section.label}
                    </h3>
                    <ul className="divide-y divide-black/5 dark:divide-white/10">
                        {section.claims.map(claim => (
                            <ClaimRow
                                key={claim.key}
                                text={claim.text}
                                sourceIds={claim.sourceIds}
                                sources={sources}
                                correction={correctionFor(claim.text)}
                                onCorrect={handleCorrect}
                                onUndo={handleUndo}
                                busy={busy}
                            />
                        ))}
                    </ul>
                </section>
            ))}
        </div>
    );
}
