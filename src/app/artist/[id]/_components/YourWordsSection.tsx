"use client";

import { useCallback, useContext, useEffect, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { EditModeContext } from "@/app/_components/EditModeContext";
import { getArtistStatements, setStatementHidden } from "@/app/actions/dashboardActions";
import RevealSection from "./RevealSection";

/**
 * The things we read out of the artist's own captions, and a way to say no.
 *
 * The vault has always let an artist reject a SOURCE — somebody else's page,
 * about them. Nothing let them reject a passage lifted out of their own words,
 * which is the more personal of the two and the one the ask quotes directly.
 *
 * The case that prompted it: Pete Rango's memorial post for his cousin André
 * produced four statements. One is about the records André handed him when he
 * moved to the states, which is origin story and belongs on his page. Three are
 * about his death — "André was a very troubled soul" — and a stranger asking
 * the ask box could get those back. Pete posted all of it publicly, and posting
 * something once is not the same as wanting a chatbot to repeat it on request.
 *
 * HIDDEN, NOT DELETED. The row stays, so this screen can still show it and put
 * it back; the exclusion is keyed on the quote, so a full re-read of the feed
 * does not quietly resurrect it. Deleting would have meant the next extraction
 * found the same caption and stored the same passage again.
 *
 * Owner-only and edit-mode-only, the same gate the vault and the knowledge
 * document already use. The server re-checks ownership regardless.
 */
type Statement = {
    quote: string;
    topic: string;
    url: string;
    postedAt: string | null;
    hidden: boolean;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function whenPosted(postedAt: string | null): string | null {
    if (!postedAt) return null;
    const d = new Date(postedAt);
    if (Number.isNaN(d.getTime())) return null;
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export default function YourWordsSection({ artistId }: { artistId: string }) {
    const { isEditing, canEdit } = useContext(EditModeContext);
    const [statements, setStatements] = useState<Statement[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        const res = await getArtistStatements(artistId);
        if (!res.success) { setError(res.error ?? "Could not load this."); setLoading(false); return; }
        setStatements(res.statements ?? []);
        setLoading(false);
    }, [artistId]);

    // Only fetched once the artist is actually editing — otherwise every page
    // view pays for a query nobody is going to look at.
    useEffect(() => {
        if (canEdit && isEditing) void load();
    }, [canEdit, isEditing, load]);

    const toggle = async (s: Statement) => {
        setBusy(s.quote);
        setError(null);
        // Optimistic, because the round trip includes a document rebuild and
        // making somebody wait to un-say something is the wrong feeling.
        setStatements(prev => prev.map(x => x.quote === s.quote ? { ...x, hidden: !x.hidden } : x));
        const res = await setStatementHidden(artistId, s.quote, !s.hidden, s.url);
        if (!res.success) {
            setError(res.error ?? "Could not save that.");
            setStatements(prev => prev.map(x => x.quote === s.quote ? { ...x, hidden: s.hidden } : x));
        }
        setBusy(null);
    };

    if (!canEdit || !isEditing) return null;
    if (!loading && statements.length === 0 && !error) return null;

    const hiddenCount = statements.filter(s => s.hidden).length;

    return (
        <RevealSection className="glass p-4 sm:p-5 space-y-3">
            <div>
                <h2 className="text-black dark:text-white text-xl font-bold">In your own words</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Read from your posts, and used to answer questions about you. Anything you
                    keep private stops being used — in answers, in your document, and in the
                    questions we ask you.
                    {hiddenCount > 0 && ` ${hiddenCount} kept private.`}
                </p>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}
            {loading && (
                <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" /> Loading…
                </p>
            )}

            <ul className="space-y-2">
                {statements.map(s => {
                    const when = whenPosted(s.postedAt);
                    return (
                        <li
                            key={s.quote}
                            className={`rounded-lg border border-black/10 dark:border-white/10 p-3 ${s.hidden ? "opacity-45" : ""}`}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                        {s.topic}
                                        {when && <span className="opacity-60"> · {when}</span>}
                                    </p>
                                    <p className="text-sm text-black dark:text-white mt-1">
                                        &ldquo;{s.quote}&rdquo;
                                    </p>
                                    {s.url && (
                                        <a
                                            href={s.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-[11px] text-gray-500 dark:text-gray-400 underline decoration-dotted underline-offset-2 mt-1 inline-block"
                                        >
                                            the post
                                        </a>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => toggle(s)}
                                    disabled={busy === s.quote}
                                    className="shrink-0 inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-black/10 dark:border-white/15 text-gray-600 dark:text-gray-400 hover:border-black/25 dark:hover:border-white/30 disabled:opacity-50"
                                    title={s.hidden ? "Use this again" : "Stop using this anywhere"}
                                >
                                    {busy === s.quote
                                        ? <Loader2 size={12} className="animate-spin" />
                                        : s.hidden ? <Eye size={12} /> : <EyeOff size={12} />}
                                    {s.hidden ? "Use it" : "Keep private"}
                                </button>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </RevealSection>
    );
}
