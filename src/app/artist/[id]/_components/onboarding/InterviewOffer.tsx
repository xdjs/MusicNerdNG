"use client";

import { useCallback, useContext, useEffect, useState } from "react";
import { MessageCircleQuestion, X } from "lucide-react";
import { EditModeContext } from "@/app/_components/EditModeContext";
import { declineInterview, getInterviewInvite, type InterviewQuestion } from "@/app/actions/interviewActions";
import InterviewPanel from "./InterviewPanel";
import { TOUR_FINISHED_EVENT } from "./ProfileTour";

/**
 * When we ask, and how hard.
 *
 * TWO MOMENTS, WITH DIFFERENT WEIGHT.
 *
 * At the END OF THE TOUR the panel opens by itself. The artist is already being
 * walked through their page, the four cards have just finished saying "here is
 * what we found", and the natural next beat is what we could not find out. Any
 * quieter and it would be missed inside a flow they are already in.
 *
 * ON A RETURN VISIT it is a card, not a takeover. Somebody who came back to
 * look at their profile did not come back to be interrupted, and the offer has
 * to survive being ignored — which a modal they dismiss does not.
 *
 * THE RULE BEHIND BOTH: we only come back when we have something new to ask
 * about, which the server decides. So a decline is never permanent and never a
 * nag, because there is nothing to return with until the artist has actually
 * done something.
 *
 * WHICH ONLY HOLDS IF A DECLINE IS WRITTEN DOWN. It was local state at first,
 * so closing the card showed the identical three questions again on the next
 * page load — the exact nagging the rule exists to prevent, from the one place
 * nobody would look for it. Declining now records those questions as skipped,
 * the same way skipping one inside the panel does. Nothing is lost: new
 * material produces new questions.
 */
export default function InterviewOffer({
    artistId,
    artistName,
}: {
    artistId: string;
    artistName: string;
}) {
    const { canEdit } = useContext(EditModeContext);
    const [questions, setQuestions] = useState<InterviewQuestion[] | null>(null);
    const [reason, setReason] = useState<"first" | "new-material">("first");
    const [open, setOpen] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    const check = useCallback(async () => {
        const invite = await getInterviewInvite(artistId).catch(() => ({ show: false }) as const);
        if (!invite.show) return null;
        setQuestions(invite.questions);
        setReason(invite.reason);
        return invite;
    }, [artistId]);

    // The returning case. Costs one query on an owner's own page and nothing at
    // all for a visitor.
    useEffect(() => {
        if (!canEdit) return;
        void check();
    }, [canEdit, check]);

    // The end-of-tour case. Asked again rather than reusing what the mount
    // fetched, because the build that preceded the tour may have produced the
    // very material this is grounded in.
    useEffect(() => {
        if (!canEdit) return;
        const onFinished = async (e: Event) => {
            if ((e as CustomEvent).detail !== artistId) return;
            const invite = await check();
            if (invite?.show) setOpen(true);
        };
        window.addEventListener(TOUR_FINISHED_EVENT, onFinished);
        return () => window.removeEventListener(TOUR_FINISHED_EVENT, onFinished);
    }, [artistId, canEdit, check]);

    if (!canEdit || !questions || questions.length === 0) return null;

    if (open) {
        return (
            <InterviewPanel
                artistId={artistId}
                artistName={artistName}
                questions={questions}
                reason={reason}
                onClose={() => {
                    setOpen(false);
                    // Answered or skipped inside the panel either way — every
                    // question they saw has a row now, so nothing needs
                    // recording here.
                    setDismissed(true);
                }}
            />
        );
    }

    if (dismissed) return null;

    return (
        <div className="glass flex items-start gap-3 rounded-xl p-4">
            <MessageCircleQuestion size={18} className="mt-0.5 shrink-0 text-pastypink" />
            <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-black dark:text-white">
                    {reason === "new-material"
                        ? "You've been busy — want to talk about it?"
                        : "Want to be interviewed by Music Nerd?"}
                </p>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {reason === "new-material"
                        ? "Three questions about what you've put out since we last spoke."
                        : "Three questions. Everything on your page right now is research — this part would be you."}
                </p>
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className="mt-2 rounded-lg bg-pastypink px-3 py-1.5 text-xs font-semibold text-black"
                >
                    Start
                </button>
            </div>
            <button
                type="button"
                onClick={() => {
                    setDismissed(true);
                    // Recorded, not just hidden — otherwise the same three come
                    // back on the next page load.
                    void declineInterview(artistId, questions);
                }}
                aria-label="Not now"
                className="shrink-0 rounded-full p-1 text-gray-500 hover:bg-black/5 dark:hover:bg-white/10"
            >
                <X size={14} />
            </button>
        </div>
    );
}
