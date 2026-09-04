"use server";

import { getServerAuthSession } from "@/server/auth";
import { getDevSession } from "@/server/utils/dev-auth";
import { canEditArtist } from "@/server/utils/artistEditAuth";
import {
    getInterviewAnswers,
    recordInterviewBatchOffered,
    upsertInterviewAnswer,
} from "@/server/utils/queries/onboardingQueries";
import { generateGroundedQuestions, sourceUrlsForQuestionKeys } from "@/server/utils/questionGenerator";
import { ONBOARDING_QUESTIONS } from "@/server/utils/onboarding/questions";
import { getArtistById } from "@/server/utils/queries/artistQueries";
import { getSocialPostsForArtist, hasOlderPostsLearnedSince } from "@/server/utils/socialIngest";
import { hasOlderCreditsLearnedSince } from "@/server/utils/queries/socialCreditQueries";
import { isResearchInFlight } from "@/server/utils/queries/researchJobQueries";
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

        /**
         * IS THE SITTING IN FRONT OF THEM THEIR FIRST.
         *
         * Read off the row, not worked out. `sitting` is assigned when a
         * question is offered and never changes, so a sitting topped up across
         * several visits keeps one number and a return gets the next.
         *
         * Five earlier versions derived this from timestamps and each had a
         * hole. The last one compared dealt-with rows against the oldest still
         * open, which breaks the moment a sitting is topped up: the added row
         * outlives the ones it joined, becomes the oldest open row, and the
         * rows it was added to start looking like an earlier sitting. The fact
         * was never in the timestamps to begin with — answering a question
         * re-stamps `created_at` and destroys the offer time that identifies
         * its sitting.
         *
         * Null is a row from before the column existed. Every artist with rows
         * then had been offered exactly one sitting.
         */
        const isFirstInterview = stillOpen.length > 0
            ? (stillOpen[0].sitting ?? 1) === 1
            : dealtWith.length === 0;

        // THE WINDOW THE QUESTIONS ARE BUILT IN, which is not always `since`.
        // `newerThan` inside the generator filters posts, credits and
        // statements by `postedAt`, so a "learned" reopening scoped to `since`
        // would generate from an empty set and fall through to the static bank
        // — the same failure, one layer down.
        let window = since;
        if (since) {
            const { published, learned } = await newMaterialSince(artistId, since);
            if (!published && !learned) return { show: false };
            // LEARNED WINS THE WINDOW WHEN BOTH ARE TRUE. Scoping to `since`
            // would make the generator drop everything published before it,
            // which is exactly the material `learned` is reporting. Unscoping
            // costs nothing the other way: a post published since the cutoff is
            // still in the pool, still the most recent thing there, and
            // `excludeKeys` is what stops old questions being repeated.
            if (learned) window = null;
        }

        // THE OPEN ROWS ARE THE QUESTIONS, not just a flag. Regenerating and
        // hoping the same keys come back leaves an outstanding question orphaned
        // whenever the model picks differently — and an orphaned open row keeps
        // every later invite unscoped and labelled a first interview, forever.
        // The post is recovered from the stored key — see
        // `sourceUrlForQuestionKey`. A resumed question used to arrive without
        // one, and I had put that down to needing a new column; the key
        // already carries the shortcode, or the credits table has the post.
        // ONE RESOLVE FOR THE WHOLE SET. Doing it per question re-read the
        // artist's entire post history each time — three open collaborator
        // questions meant three full fetches plus three signal derivations, on
        // a path that runs on every page load with an open sitting.
        //
        // Scoped with the same `since` the questions were generated under, so a
        // "new material" sitting cannot link back to a pre-`since` post the
        // model never saw. And it never throws: this sits inside the catch that
        // returns { show: false }, so a failed lookup would have cost the
        // artist the whole interview rather than one underline.
        const links = await sourceUrlsForQuestionKeys(
            artistId, stillOpen.map(r => r.questionKey), { since: window },
        ).catch(() => new Map<string, string>());
        const resumed: InterviewQuestion[] = stillOpen.map(r => ({
            key: r.questionKey,
            question: r.question,
            sourceUrl: links.get(r.questionKey),
        }));
        // DO NOT ASK BEFORE THE MATERIAL EXISTS. Questions are written from
        // what caption extraction produces, and extraction finishes seventy
        // seconds to several minutes after the posts land. Generating inside
        // that window fills every slot from the static bank — and those rows
        // persist under (artist_id, question_key), which sets `since` and gates
        // every later sitting. On production Pete Rango's questions were
        // written at 13:18:08 and his extraction was queued at 13:19:16; the
        // 187 credits it found arrived too late to be used. Tom Vek's ran two
        // minutes after his and read fine. Nothing was different but timing.
        //
        // An open sitting still RESUMES — those questions exist and so does
        // what they were built on — but it is not topped up to a full set
        // while extraction runs. Topping up mid-extraction pulls static
        // fillers from incomplete material and persists them, which is the
        // lockout this guard exists to prevent. Mutation-testing caught that:
        // an earlier version exempted open sittings from the wait, and no test
        // could tell the two apart because both return the resumed questions.
        // BOTH STAGES. caption_extract is enqueued only once social_ingest
        // completes, so during the scrape there is no extraction row and asking
        // about extraction alone answers "nothing in flight" — false for the
        // whole one-to-five minutes the scrape takes. Pete's questions were
        // written at 13:18:08 with ingest still running and extraction not
        // queued until 13:19:16, so a guard on extraction alone would have let
        // his sitting through unchanged.
        //
        // Short-circuited: a sitting already full needs no generation and must
        // not pay for this query on every page load, which is the same reason
        // sourceUrlsForQuestionKeys resolves once for the whole set.
        const generated = resumed.length >= QUESTION_COUNT
            || await isResearchInFlight(artistId, ["social_ingest", "caption_extract"])
            ? []
            : await pickQuestions(
                artistId,
                window,
                // The grounded-material window may be widened to the whole
                // feed when we learned old material. A release still needs the
                // real answer-time cutoff: otherwise a simultaneous release +
                // learned reopen silently drops the release fallback.
                since,
                new Set([...answeredKeys, ...resumed.map(q => q.key)]),
                isFirstInterview,
            );
        const questions = [...resumed, ...generated].slice(0, QUESTION_COUNT);
        if (questions.length === 0) return { show: false };

        // The same fact drives the copy. An artist resuming an abandoned second
        // sitting was being shown the first-interview introduction, because
        // `since` is null while resuming.
        return { show: true, reason: isFirstInterview ? "first" : "new-material", questions };
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

/**
 * WHY the interview may reopen — not just whether.
 *
 * "published" is something the artist put out since we last spoke: a post, a
 * record. The date means something, so the questions are scoped to it and are
 * about the new thing.
 *
 * "learned" is something WE found out since: posts stored, or credits read out
 * of captions we already held. Just as real, but the posts behind it were
 * published months ago. Scoping by publication date filters every one of them
 * away — which is how an artist could be told there was nothing new minutes
 * after we finished reading 199 of his posts and pulling 187 credits out of
 * them. For "learned" the whole feed is the window; `excludeKeys` is what stops
 * repeats, not the date.
 *
 * The old version of this returned a bare boolean and its docstring said "a
 * post scraped" while the code checked `postedAt`. The comment described the
 * intent and the code did something else.
 *
 * BOTH CAN BE TRUE AT ONCE, which is why this is not an enum.
 *
 * The first version returned one of "none" | "published" | "learned" and
 * answered "published" the moment it found a newer post, without ever asking
 * about learned material. A scrape that brings in one new post AND finally
 * extracts credits from two years of older captions is the common case for a
 * returning artist — and that version kept the window scoped to `since`, so
 * `newerThan` dropped every one of the older credits. Not the full lockout the
 * rest of this fix is about, but the same loss in miniature, and no test caught
 * it because the tests exercised the two branches separately.
 */
type NewMaterial = { published: boolean; learned: boolean };

async function newMaterialSince(artistId: string, since: string): Promise<NewMaterial> {
    const none = { published: false, learned: false };
    const cutoff = Date.parse(since);
    if (Number.isNaN(cutoff)) return none;

    const posts = await getSocialPostsForArtist(artistId).catch(() => []);
    let published = posts.some(p => {
        const at = Date.parse(p.postedAt ?? "");
        return !Number.isNaN(at) && at > cutoff;
    });

    if (!published) {
        const artist = await getArtistById(artistId).catch(() => null);
        if (artist?.spotify) {
            const releases = await getSpotifyCatalogDetail(artist.spotify, await getSpotifyHeaders()).catch(() => []);
            published = releases.some(r => {
                const at = Date.parse(r.releaseDate ?? "");
                return !Number.isNaN(at) && at > cutoff;
            });
        }
    }

    // Deliberately asked even when `published` is already true. These queries
    // are bounded by posted_at <= since, so they answer specifically "is there
    // OLD material we only just learned" — a question a new post cannot answer
    // and does not make redundant.
    const learned = await hasOlderPostsLearnedSince(artistId, since)
        || await hasOlderCreditsLearnedSince(artistId, since);

    return { published, learned };
}

/**
 * Grounded questions first, the static bank filling any gap — the same order
 * the onboarding chat used, because a question about something the artist
 * actually posted is worth three generic ones.
 */
async function pickQuestions(
    artistId: string,
    /** The date window to generate in. Null means the whole feed. */
    generationSince: string | null,
    /** The actual previous-answer cutoff for release fallback. Unlike the
     *  grounded-material window, this must not be widened when old captions
     *  were learned at the same time as a new Spotify release. */
    releaseSince: string | null,
    answeredKeys: Set<string>,
    /** WHETHER THIS IS THEIR FIRST SITTING. Passed in rather than inferred from
     *  `since`: a null window means "generate from the whole feed", which is
     *  true for a returning artist as often as a new one, and topping a
     *  returning artist's sitting up from the static bank asks them "How would
     *  you describe your sound?" for the second time. */
    isFirstInterview: boolean,
): Promise<InterviewQuestion[]> {
    // `excludeKeys`, not just the filter below. Passing them in removes them
    // from the candidate POOL, so the model spends its picks on things the
    // artist has not been asked yet — filtering afterwards threw away work
    // already done and left the static bank to fill the gap.
    const grounded = await generateGroundedQuestions(artistId, { max: QUESTION_COUNT, since: generationSince, excludeKeys: answeredKeys })
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
        for (const r of await newReleasesSince(artistId, releaseSince)) {
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
    if (!isFirstInterview) return picked;

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
    questions: InterviewQuestion[];
}): Promise<{ success: boolean; error?: string }> {
    const session = await getServerAuthSession() ?? await getDevSession();
    if (!session) return { success: false, error: "Not authenticated" };
    try {
        if (!(await canEditArtist(session.user.id, input.artistId))) {
            return { success: false, error: "Not authorized for this artist" };
        }

        const question = input.question.trim().slice(0, 500);
        if (!input.questionKey || !question) return { success: false, error: "Nothing to save" };

        const offered = input.questions.slice(0, QUESTION_COUNT).map(q => ({
            questionKey: q.key,
            question: q.question.trim().slice(0, 500),
        }));
        if (!offered.some(q => q.questionKey === input.questionKey)) {
            return { success: false, error: "Question is not in this interview" };
        }

        // InterviewPanel marks the batch on mount without blocking the UI. A
        // very fast answer can beat that request, so ensure the WHOLE batch has
        // one sitting before converting this row to an answer. Marking only
        // this question would let the delayed mount request put the remaining
        // questions into the next sitting after this row stops being open.
        await recordInterviewBatchOffered(input.artistId, offered);
        await upsertInterviewAnswer({
            artistId: input.artistId,
            questionKey: input.questionKey,
            question,
            answer: input.answer?.trim().slice(0, MAX_ANSWER_CHARS) || null,
            // Only used if the preceding insert somehow did not create the
            // row. Existing rows keep their stored sitting on conflict.
            sitting: 1,
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
        const declined = questions.slice(0, QUESTION_COUNT);

        // The card can be dismissed before InterviewPanel mounts, so its
        // normal markInterviewOffered effect has not run. Assign the whole
        // batch to a sitting first; the answer upsert below deliberately keeps
        // that stored number unchanged while turning each row into a skip.
        await recordInterviewBatchOffered(
            artistId,
            declined.map(q => ({
                questionKey: q.key,
                question: q.question.trim().slice(0, 500),
            })),
        );

        for (const q of declined) {
            await upsertInterviewAnswer({
                artistId,
                questionKey: q.key,
                question: q.question.trim().slice(0, 500),
                answer: null,
                // recordInterviewBatchOffered just created the row. This is the
                // insert-side fallback; conflicts preserve the stored number.
                sitting: 1,
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
        // Insert-only after the sitting lookup. Reading an existing answer and
        // then writing nulls left a window in which an answer typed in between
        // was overwritten — losing what the artist had just written, on the
        // one screen where the words are theirs. The conflict is now a no-op.
        await recordInterviewBatchOffered(
            artistId,
            questions.slice(0, QUESTION_COUNT).map(q => ({
                questionKey: q.key,
                question: q.question.trim().slice(0, 500),
            })),
        );
        return { success: true };
    } catch (e) {
        console.error("[markInterviewOffered] Error:", e);
        return { success: false };
    }
}
