"use server";

import { getServerAuthSession } from "@/server/auth";
import { getDevSession } from "@/server/utils/dev-auth";
import { canEditArtist } from "@/server/utils/artistEditAuth";
import {
    getInterviewAnswers,
    upsertInterviewAnswer,
} from "@/server/utils/queries/onboardingQueries";
import { generateGroundedQuestions } from "@/server/utils/questionGenerator";
import { ONBOARDING_QUESTIONS } from "@/server/utils/onboarding/questions";
import { getArtistById } from "@/server/utils/queries/artistQueries";
import { getSocialPostsForArtist } from "@/server/utils/socialIngest";
import { getSpotifyCatalogDetail, getSpotifyHeaders } from "@/server/utils/queries/externalApiQueries";

/**
 * The interview, outside the onboarding step machine.
 *
 * The machinery — grounded questions, answer storage, the acknowledgement
 * written back — was built for the step-by-step chat and then stranded: the
 * auto-build confirms `interview` and `publish` itself, so an artist reaches a
 * finished page having answered nothing, and `OnboardingGate` only renders
 * while onboarding is INCOMPLETE. Zero interview answers had ever been stored.
 *
 * This is deliberately NOT a fix to the step machine. The whole point of the
 * second ask is that it happens when onboarding is long finished, which the
 * step machine cannot express — its states run out at "publish". So the
 * interview gets its own entry point and reuses the parts that already work.
 */

/** Three, as the onboarding budget always was. Enough to be worth doing,
 *  short enough that somebody finishes it. */
const QUESTION_COUNT = 3;

export type InterviewQuestion = { key: string; question: string };

export type InterviewInvite =
    | { show: false }
    | {
        show: true;
        /** "first" the artist has never answered anything; "new-material" they
         *  have, and something has happened since. Only the copy differs. */
        reason: "first" | "new-material";
        questions: InterviewQuestion[];
    };

/**
 * Should we ask, and what?
 *
 * THE RULE: we only come back when we have something new to ask about. A
 * decline is therefore never permanent and never a nag — there is nothing to
 * return with until the artist has actually done something. It also means the
 * questions are about that something, rather than the same three again.
 *
 * "Something new" is a post we have scraped or a release that has appeared in
 * the catalogue since their last answer. Instagram and Spotify are the only two
 * feeds we actually hold: Apify reads Instagram and nothing reads X, so an
 * artist whose activity is all on X will not trigger this. Better to say that
 * than to imply a signal we do not have.
 */
export async function getInterviewInvite(artistId: string): Promise<InterviewInvite> {
    const session = await getServerAuthSession() ?? await getDevSession();
    if (!session) return { show: false };
    try {
        // Admins may edit any artist, owners only their claimed one — the same
        // check the vault and the knowledge document use.
        if (!(await canEditArtist(session.user.id, artistId))) return { show: false };

        const answers = await getInterviewAnswers(artistId);
        // Skipped questions count as answered for this purpose: they were asked
        // and dealt with, and re-offering them is the nagging we are avoiding.
        const answeredKeys = new Set(answers.map(a => a.questionKey));
        const lastAnsweredAt = answers.reduce<string | null>((latest, a) => {
            const at = a.createdAt ? String(a.createdAt) : null;
            if (!at) return latest;
            return !latest || at > latest ? at : latest;
        }, null);

        const since = lastAnsweredAt;
        if (since && !(await hasNewMaterialSince(artistId, since))) return { show: false };

        const questions = await pickQuestions(artistId, since, answeredKeys);
        if (questions.length === 0) return { show: false };

        return { show: true, reason: since ? "new-material" : "first", questions };
    } catch (e) {
        console.error("[getInterviewInvite] Error:", e);
        return { show: false };
    }
}

/** A post scraped or a record released since they last told us anything. */
async function hasNewMaterialSince(artistId: string, since: string): Promise<boolean> {
    const cutoff = Date.parse(since);
    if (Number.isNaN(cutoff)) return false;

    const posts = await getSocialPostsForArtist(artistId).catch(() => []);
    const newPost = posts.some(p => {
        const at = Date.parse(p.postedAt ?? "");
        return !Number.isNaN(at) && at > cutoff;
    });
    if (newPost) return true;

    const artist = await getArtistById(artistId).catch(() => null);
    if (!artist?.spotify) return false;
    const releases = await getSpotifyCatalogDetail(artist.spotify, await getSpotifyHeaders()).catch(() => []);
    return releases.some(r => {
        const at = Date.parse(r.releaseDate ?? "");
        return !Number.isNaN(at) && at > cutoff;
    });
}

/**
 * Grounded questions first, the static bank filling any gap — the same order
 * the onboarding chat used, because a question about something the artist
 * actually posted is worth three generic ones.
 */
async function pickQuestions(
    artistId: string,
    since: string | null,
    answeredKeys: Set<string>,
): Promise<InterviewQuestion[]> {
    const grounded = await generateGroundedQuestions(artistId, { max: QUESTION_COUNT, since })
        .catch(() => []);
    const picked: InterviewQuestion[] = grounded
        .filter(q => !answeredKeys.has(q.key))
        .slice(0, QUESTION_COUNT)
        .map(q => ({ key: q.key, question: q.question }));

    // The static bank only fills a FIRST interview. Coming back with "what got
    // you started?" when the artist has just released a record is exactly the
    // generic re-ask this design exists to avoid — better to stay quiet.
    if (since) return picked;

    for (const q of ONBOARDING_QUESTIONS) {
        if (picked.length >= QUESTION_COUNT) break;
        if (answeredKeys.has(q.key)) continue;
        picked.push({ key: q.key, question: q.question });
    }
    return picked;
}

/**
 * Store one answer, or the fact that they skipped it.
 *
 * A skip is written down, not ignored: without a row the question comes back
 * the next time we look, which is the same nag from a different direction.
 */
export async function answerInterviewQuestion(input: {
    artistId: string;
    questionKey: string;
    question: string;
    answer: string | null;
}): Promise<{ success: boolean; error?: string }> {
    const session = await getServerAuthSession() ?? await getDevSession();
    if (!session) return { success: false, error: "Not authenticated" };
    try {
        if (!(await canEditArtist(session.user.id, input.artistId))) {
            return { success: false, error: "Not authorized for this artist" };
        }

        const question = input.question.trim().slice(0, 500);
        if (!input.questionKey || !question) return { success: false, error: "Nothing to save" };

        await upsertInterviewAnswer({
            artistId: input.artistId,
            questionKey: input.questionKey,
            question,
            answer: input.answer?.trim() || null,
            // "followup" is what the column was always for; the first sitting
            // through this surface is still a follow-up to the auto-build,
            // which is what actually happened.
            source: "followup",
        });
        return { success: true };
    } catch (e) {
        console.error("[answerInterviewQuestion] Error:", e);
        return { success: false, error: "Could not save that" };
    }
}

/**
 * Finished a sitting. Rebuilds the document so what they just said is on their
 * page rather than sitting in a table waiting for the next unrelated refresh.
 */
export async function finishInterview(artistId: string): Promise<{ success: boolean }> {
    const session = await getServerAuthSession() ?? await getDevSession();
    if (!session) return { success: false };
    try {
        if (!(await canEditArtist(session.user.id, artistId))) return { success: false };
        const { refreshArtistDoc } = await import("@/server/utils/artistDocService");
        await refreshArtistDoc(artistId);
        return { success: true };
    } catch (e) {
        console.error("[finishInterview] Error:", e);
        return { success: false };
    }
}
