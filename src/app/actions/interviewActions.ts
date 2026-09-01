"use server";

import { getServerAuthSession } from "@/server/auth";
import { getDevSession } from "@/server/utils/dev-auth";
import { canEditArtist } from "@/server/utils/artistEditAuth";
import {
    getInterviewAnswers,
    recordInterviewOffered,
    upsertInterviewAnswer,
} from "@/server/utils/queries/onboardingQueries";
import { generateGroundedQuestions, sourceUrlForQuestionKey } from "@/server/utils/questionGenerator";
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

/** The textarea says 2,000 too, but a server action is a public endpoint and
 *  the client's maxLength is a suggestion. An unbounded answer is interpolated
 *  straight into the ask prompt and the document build, so one oversized
 *  submission would break both for that artist until somebody noticed. */
const MAX_ANSWER_CHARS = 2_000;

export type InterviewQuestion = {
    key: string;
    question: string;
    /**
     * The post the question was written from, when there is one.
     *
     * The generator has always produced these and this type dropped them. An
     * artist reading "your cousin André handed you 112's Part III and Dr. Dre's
     * 2001" may not remember which post that was, and a question you cannot
     * place is a question you cannot answer — Pete, on his own interview: "I
     * may not remember at that moment."
     *
     * Absent only for the static bank, which has no post behind it. A RESUMED
     * question recovers its post from the stored key — see
     * `sourceUrlForQuestionKey`. I had said that needed a new column; it does
     * not, because the key already carries the shortcode or the credits table
     * has the post.
     */
    sourceUrl?: string;
};

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

        // FAIL CLOSED. getInterviewAnswers swallows its own errors and returns
        // [], which here reads as "they have never answered anything" — so a
        // database blip would offer a first interview to somebody who has
        // already done one, and every question they had answered again.
        const rows = await getInterviewAnswers(artistId);
        if (rows === null) return { show: false };
        // A question we put to them and they have not dealt with yet. This is
        // the boundary of a sitting, and it is why the row exists.
        const stillOpen = rows.filter(r => r.source === "offered");
        const dealtWith = rows.filter(r => r.source !== "offered");

        // Skipped questions count as dealt with: they were asked and answered
        // by being declined, and re-offering them is the nagging we avoid.
        const answeredKeys = new Set(dealtWith.map(a => a.questionKey));
        const lastAnsweredAt = dealtWith.reduce<string | null>((latest, a) => {
            const at = a.createdAt ? String(a.createdAt) : null;
            if (!at) return latest;
            return !latest || at > latest ? at : latest;
        }, null);

        // AN UNFINISHED SITTING IS NOT A FINISHED ONE. Answering one question
        // and closing the tab made `since` truthy, and the gate then hid the
        // rest until the artist happened to post something, so the sitting
        // could never be resumed.
        //
        // A LIFETIME ROW COUNT CANNOT SEE THIS. After a completed first sitting
        // an artist who answers one question of a second has four rows, which
        // is not "fewer than a set" — and the questions that came with it were
        // hidden for good. The open rows are the boundary: they say which
        // questions are outstanding from the offer that is actually in front of
        // them.
        const since = stillOpen.length > 0 ? null : lastAnsweredAt;

        if (since && !(await hasNewMaterialSince(artistId, since))) return { show: false };

        // THE OPEN ROWS ARE THE QUESTIONS, not just a flag. Regenerating and
        // hoping the same keys come back leaves an outstanding question orphaned
        // whenever the model picks differently — and an orphaned open row keeps
        // every later invite unscoped and labelled a first interview, forever.
        // The post is recovered from the stored key — see
        // `sourceUrlForQuestionKey`. A resumed question used to arrive without
        // one, and I had put that down to needing a new column; the key
        // already carries the shortcode, or the credits table has the post.
        // EACH LINK FAILS ALONE. A rejection inside Promise.all rejects the
        // whole thing, and this sits inside the outer catch that returns
        // { show: false } — so a hiccup resolving a link would have cost the
        // artist the entire interview rather than one underline.
        const resumed: InterviewQuestion[] = await Promise.all(
            stillOpen.map(async r => ({
                key: r.questionKey,
                question: r.question,
                sourceUrl: await sourceUrlForQuestionKey(artistId, r.questionKey).catch(() => undefined),
            })),
        );
        const generated = resumed.length >= QUESTION_COUNT
            ? []
            : await pickQuestions(artistId, since, new Set([...answeredKeys, ...resumed.map(q => q.key)]));
        const questions = [...resumed, ...generated].slice(0, QUESTION_COUNT);
        if (questions.length === 0) return { show: false };

        return { show: true, reason: since ? "new-material" : "first", questions };
    } catch (e) {
        console.error("[getInterviewInvite] Error:", e);
        return { show: false };
    }
}

/** Records that appeared since they last told us anything, newest first. */
async function newReleasesSince(artistId: string, since: string | null): Promise<{ name: string; releaseDate: string | null }[]> {
    const artist = await getArtistById(artistId).catch(() => null);
    if (!artist?.spotify) return [];
    const releases = await getSpotifyCatalogDetail(artist.spotify, await getSpotifyHeaders()).catch(() => []);
    const cutoff = since ? Date.parse(since) : NaN;
    return releases
        .filter(r => {
            if (Number.isNaN(cutoff)) return false;   // only for a RETURN visit
            const at = Date.parse(r.releaseDate ?? "");
            return !Number.isNaN(at) && at > cutoff;
        })
        .map(r => ({ name: r.name, releaseDate: r.releaseDate ?? null }));
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
    // `excludeKeys`, not just the filter below. Passing them in removes them
    // from the candidate POOL, so the model spends its picks on things the
    // artist has not been asked yet — filtering afterwards threw away work
    // already done and left the static bank to fill the gap.
    const grounded = await generateGroundedQuestions(artistId, { max: QUESTION_COUNT, since, excludeKeys: answeredKeys })
        .catch(() => []);
    const picked: InterviewQuestion[] = grounded
        .filter(q => !answeredKeys.has(q.key))
        .slice(0, QUESTION_COUNT)
        // Optional chain: the type says sourceUrls is always there, and a
        // question that arrives without one must still be askable rather than
        // throwing and costing the artist the whole interview.
        .map(q => ({ key: q.key, question: q.question, sourceUrl: q.sourceUrls?.[0] }));

    // A RELEASE WITH NO POSTS BEHIND IT STILL DESERVES A QUESTION. Releases
    // trigger the invite, but the generator reads captions — so an artist who
    // put out a record and said nothing about it on Instagram produced no
    // questions at all, and the invite was suppressed. The release trigger did
    // nothing, silently, which is the half of the design that would have looked
    // like it worked.
    if (picked.length < QUESTION_COUNT) {
        for (const r of await newReleasesSince(artistId, since)) {
            if (picked.length >= QUESTION_COUNT) break;
            // UNICODE, AND THE DATE. [^a-z0-9] reduces a Korean or Japanese
            // title to nothing, so every non-Latin release collapsed onto the
            // same key — and (artist, questionKey) is unique, so the second
            // answer would have overwritten the first and silently destroyed
            // what the artist had already written. The date disambiguates two
            // releases that normalise alike for any other reason.
            const slug = r.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "");
            const key = `release_${slug || "untitled"}_${r.releaseDate ?? "undated"}`.slice(0, 180);
            if (answeredKeys.has(key)) continue;
            // Not generated: we know the title and the date and nothing else,
            // and inventing a detail about a record we have not heard is how
            // this goes wrong. The question is plain and true.
            picked.push({ key, question: `You put out "${r.name}" — what would you want somebody to notice about it first?` });
        }
    }

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
            answer: input.answer?.trim().slice(0, MAX_ANSWER_CHARS) || null,
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

/**
 * They closed the offer without answering.
 *
 * Recorded as skips, one row per question, for the same reason the panel
 * records a skipped question: without a row the identical three come back on
 * the next page load, which is the nagging the whole design is built to avoid.
 * Pete's rule is that we return when there is something NEW — and something new
 * produces new questions, so nothing is lost by closing the door on these.
 */
export async function declineInterview(
    artistId: string,
    questions: InterviewQuestion[],
): Promise<{ success: boolean }> {
    const session = await getServerAuthSession() ?? await getDevSession();
    if (!session) return { success: false };
    try {
        if (!(await canEditArtist(session.user.id, artistId))) return { success: false };
        for (const q of questions.slice(0, QUESTION_COUNT)) {
            await upsertInterviewAnswer({
                artistId,
                questionKey: q.key,
                question: q.question.trim().slice(0, 500),
                answer: null,
                source: "followup",
            });
        }
        return { success: true };
    } catch (e) {
        console.error("[declineInterview] Error:", e);
        return { success: false };
    }
}

/**
 * They opened the panel. Record what was put to them.
 *
 * Written as "offered" rather than skipped: these are questions in front of the
 * artist right now, not ones they declined. If they close the browser halfway
 * the rows survive, and the next visit resumes the sitting instead of hiding it
 * behind the new-material gate — which is what happened before this existed.
 */
export async function markInterviewOffered(
    artistId: string,
    questions: InterviewQuestion[],
): Promise<{ success: boolean }> {
    const session = await getServerAuthSession() ?? await getDevSession();
    if (!session) return { success: false };
    try {
        if (!(await canEditArtist(session.user.id, artistId))) return { success: false };
        // Insert-only, and no read first. Reading the existing rows and then
        // writing nulls left a window in which an answer typed in the moment
        // between the two was overwritten with `answer: null` — losing what the
        // artist had just written, on the one screen where the words are theirs.
        await Promise.all(questions.slice(0, QUESTION_COUNT).map(q =>
            recordInterviewOffered({
                artistId,
                questionKey: q.key,
                question: q.question.trim().slice(0, 500),
            })));
        return { success: true };
    } catch (e) {
        console.error("[markInterviewOffered] Error:", e);
        return { success: false };
    }
}
