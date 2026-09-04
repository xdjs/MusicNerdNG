"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2, X } from "lucide-react";
import {
    answerInterviewQuestion,
    finishInterview,
    markInterviewOffered,
    type InterviewQuestion,
} from "@/app/actions/interviewActions";

/**
 * Three questions, asked one at a time.
 *
 * The whole reason this exists: the auto-build gives an artist a finished page
 * in about forty seconds and asks them for nothing, so everything on it is
 * research. This is the only part of onboarding where what lands on the page
 * comes from them — and a search engine cannot do it.
 *
 * ONE AT A TIME, not a form. Three text boxes on a screen reads as homework and
 * gets abandoned at the first one; a single question with a Skip next to it
 * reads as a conversation and gets finished. It is also how the onboarding chat
 * already asked them, so the copy and the pacing are not new inventions.
 *
 * SKIP IS RECORDED, not ignored. A skipped question is written down with a null
 * answer so it is never asked again — without the row it comes back next time,
 * which is the nagging this design exists to avoid.
 */
export default function InterviewPanel({
    artistId,
    artistName,
    questions,
    reason,
    onClose,
}: {
    artistId: string;
    artistName: string;
    questions: InterviewQuestion[];
    reason: "first" | "new-material";
    onClose: () => void;
}) {
    const [index, setIndex] = useState(0);
    const [answer, setAnswer] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);
    const [answered, setAnswered] = useState(0);

    // Written down the moment the panel opens, so a sitting abandoned by
    // closing the browser can be resumed rather than disappearing behind the
    // new-material gate.
    useEffect(() => {
        void markInterviewOffered(artistId, questions);
    }, [artistId, questions]);

    const current = questions[index];

    const advance = async (text: string | null) => {
        if (!current || busy) return;
        setBusy(true);
        setError(null);
        const res = await answerInterviewQuestion({
            artistId,
            questionKey: current.key,
            question: current.question,
            answer: text,
            questions,
        });
        if (!res.success) {
            setError(res.error ?? "Could not save that.");
            setBusy(false);
            return;
        }
        if (text) setAnswered(n => n + 1);
        setAnswer("");

        if (index + 1 < questions.length) {
            setIndex(index + 1);
            setBusy(false);
            return;
        }
        // Rebuild now, so what they just said is on the page rather than
        // waiting in a table for an unrelated refresh.
        await finishInterview(artistId).catch(() => undefined);
        setDone(true);
        setBusy(false);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-[#151515]">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h2 className="text-lg font-bold text-black dark:text-white">
                            {done
                                ? "Thank you"
                                : reason === "new-material"
                                    ? "You've been busy"
                                    : "A few questions"}
                        </h2>
                        {!done && (
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                {reason === "new-material"
                                    ? "We noticed some new things. Three questions, skip any of them."
                                    : "Three quick questions, in your own words. Skip any of them."}
                            </p>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="shrink-0 rounded-full p-1 text-gray-500 hover:bg-black/5 dark:hover:bg-white/10"
                    >
                        <X size={16} />
                    </button>
                </div>

                {done ? (
                    <div className="mt-4 space-y-3">
                        <p className="text-sm text-black dark:text-white">
                            {answered > 0
                                ? `That's on your page now, in your words — and ${artistName}'s page answers with it from here.`
                                : "No problem. We'll ask again when you've got something new going on."}
                        </p>
                        <button
                            type="button"
                            onClick={onClose}
                            className="w-full rounded-xl bg-pastypink py-2.5 text-sm font-semibold text-black"
                        >
                            Done
                        </button>
                    </div>
                ) : current ? (
                    <div className="mt-4 space-y-3">
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            {index + 1} of {questions.length}
                        </p>
                        <p className="text-sm font-medium text-black dark:text-white">{current.question}</p>
                        {/* THE POST IT CAME FROM.
                          *
                          * These questions are about things the artist wrote,
                          * sometimes years ago — "your cousin André handed you
                          * 112's Part III and Dr. Dre's 2001" is precise and
                          * still may not be placeable from memory. Pete, on his
                          * own interview: "I may not remember at that moment."
                          *
                          * Only shown when there is one. The static bank has no
                          * post behind it; a RESUMED question does, recovered
                          * from its stored key by `sourceUrlsForQuestionKeys`.
                          * This comment used to say resumed questions had none,
                          * which was true for about an hour and would have sent
                          * the next reader looking for a bug that was not
                          * there. */}
                        {current.sourceUrl && (
                            <a
                                href={current.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-gray-500 underline underline-offset-2 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                            >
                                <ExternalLink size={11} />
                                See the post this came from
                            </a>
                        )}
                        <textarea
                            value={answer}
                            onChange={e => setAnswer(e.target.value)}
                            rows={4}
                            maxLength={2000}
                            placeholder="However you'd say it."
                            className="w-full rounded-xl border border-black/10 bg-transparent p-3 text-sm text-black outline-none focus:border-black/25 dark:border-white/15 dark:text-white dark:focus:border-white/30"
                        />
                        {error && <p className="text-sm text-red-400">{error}</p>}
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => advance(answer)}
                                disabled={busy || answer.trim().length === 0}
                                className="flex-1 rounded-xl bg-pastypink py-2.5 text-sm font-semibold text-black disabled:opacity-40"
                            >
                                {busy ? <Loader2 size={14} className="mx-auto animate-spin" /> : "Send"}
                            </button>
                            {/* Written down as a skip, so it is never asked again. */}
                            <button
                                type="button"
                                onClick={() => advance(null)}
                                disabled={busy}
                                className="rounded-xl border border-black/10 px-4 py-2.5 text-sm text-gray-600 disabled:opacity-40 dark:border-white/15 dark:text-gray-400"
                            >
                                Skip
                            </button>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
