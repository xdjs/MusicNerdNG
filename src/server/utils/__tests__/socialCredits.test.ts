/**
 * The verification layer, which is the part that has to be right.
 *
 * `extractCaptionCredits` asks a model to read captions, and a model asked to
 * read captions will occasionally report a person who is not in them, a quote
 * it tidied up, or a url from a different post. None of those can be allowed
 * onto an artist's profile. `verifyClaims` is pure and every one of these runs
 * without a model, so the guards are tested rather than trusted.
 */
import { verifyClaims, creditedCollaborators, selfCredits, captionBearingPosts } from "@/server/utils/socialCredits";
import type { SocialPostRow } from "@/server/utils/socialSignals";

const POST_URL = "https://www.instagram.com/p/DScwWGzkYcJ/";
const OTHER_URL = "https://www.instagram.com/p/DIT-FmFRvK7/";

function post(over: Partial<SocialPostRow> = {}): SocialPostRow {
    return {
        platform: "instagram",
        platformPostId: "1",
        ownerUsername: "pharaohsistare",
        isOwnPost: true,
        caption: "Enjoy 💚\n\nMixing & Mastering Engineer: @p3t3rango\nWritten & Produced by: Pharaoh Sistare",
        url: POST_URL,
        postedAt: "2025-12-19T15:00:00.000Z",
        likeCount: 100, commentCount: 5, playCount: null,
        hashtags: [], mentions: ["p3t3rango"], coauthors: [],
        musicTitle: null, musicArtist: null,
        ...over,
    };
}

const ARTIST = "Pharaoh Sistare";
const HANDLE = "pharaohsistare";

function credit(over: Record<string, unknown> = {}) {
    return {
        subject: "p3t3rango",
        isHandle: true,
        role: "Mixing & Mastering Engineer",
        quote: "Mixing & Mastering Engineer: @p3t3rango",
        url: POST_URL,
        ...over,
    };
}

describe("verifyClaims", () => {
    it("keeps a credit that is really in the caption", () => {
        const out = verifyClaims({ credits: [credit()], statements: [] }, [post()], ARTIST, HANDLE);
        expect(out.credits).toHaveLength(1);
        expect(out.credits[0]).toMatchObject({
            subject: "p3t3rango",
            role: "Mixing & Mastering Engineer",
            isHandle: true,
            isSelf: false,
            url: POST_URL,
        });
    });

    it("drops a claim citing a post it was never given", () => {
        const out = verifyClaims({ credits: [credit({ url: OTHER_URL })], statements: [] }, [post()], ARTIST, HANDLE);
        expect(out.credits).toHaveLength(0);
    });

    it("drops a quote that does not appear in that caption", () => {
        const out = verifyClaims(
            { credits: [credit({ quote: "Mastered at Abbey Road by @p3t3rango" })], statements: [] },
            [post()], ARTIST, HANDLE);
        expect(out.credits).toHaveLength(0);
    });

    it("drops a person who is neither mentioned nor named in the caption", () => {
        // The quote is real and the url is real; only the subject is invented.
        const out = verifyClaims(
            { credits: [credit({ subject: "someoneelse", isHandle: true })], statements: [] },
            [post()], ARTIST, HANDLE);
        expect(out.credits).toHaveLength(0);
    });

    it("will not accept a subject that is only a fragment of another word", () => {
        // Folded containment accepted the subject "Art" because the caption
        // contains "started". A model that invents a collaborator should not
        // clear the verification boundary on a coincidence of letters.
        const p = post({ caption: "started this one in a hotel room", mentions: [] });
        const out = verifyClaims(
            { credits: [credit({ subject: "Art", isHandle: false, role: "Cover art by", quote: "started this one in a hotel room" })], statements: [] },
            [p], ARTIST, HANDLE);
        expect(out.credits).toHaveLength(0);
    });

    it("accepts a bare name written in the caption even with no @mention", () => {
        const p = post({ caption: "Strings by Elizabeth Owens, recorded live.", mentions: [] });
        const out = verifyClaims(
            { credits: [credit({ subject: "Elizabeth Owens", isHandle: false, role: "Strings by", quote: "Strings by Elizabeth Owens, recorded live." })], statements: [] },
            [p], ARTIST, HANDLE);
        expect(out.credits).toHaveLength(1);
        expect(out.credits[0].isHandle).toBe(false);
    });

    it("tolerates reflowed whitespace but not altered words", () => {
        const kept = verifyClaims(
            { credits: [credit({ quote: "Mixing  &   Mastering Engineer:   @p3t3rango" })], statements: [] },
            [post()], ARTIST, HANDLE);
        expect(kept.credits).toHaveLength(1);

        const dropped = verifyClaims(
            { credits: [credit({ quote: "Mixing and Mastering Engineer: @p3t3rango" })], statements: [] },
            [post()], ARTIST, HANDLE);
        expect(dropped.credits).toHaveLength(0);
    });

    describe("self-credits", () => {
        it("marks the artist crediting themselves by name", () => {
            const out = verifyClaims(
                { credits: [credit({ subject: "Pharaoh Sistare", isHandle: false, role: "Written & Produced by", quote: "Written & Produced by: Pharaoh Sistare" })], statements: [] },
                [post()], ARTIST, HANDLE);
            expect(out.credits[0].isSelf).toBe(true);
        });

        it("marks the artist crediting their own handle", () => {
            const p = post({ caption: "Mixed by @pharaohsistare", mentions: ["pharaohsistare"] });
            const out = verifyClaims(
                { credits: [credit({ subject: "pharaohsistare", role: "Mixed by", quote: "Mixed by @pharaohsistare" })], statements: [] },
                [p], ARTIST, HANDLE);
            expect(out.credits[0].isSelf).toBe(true);
        });

        it("keeps a two-letter first-person credit, which the length floor used to eat", () => {
            // "me" folds to two characters and failed the >= 3 floor, so the
            // credit was dropped before isSelf could see it — SELF_WORDS
            // contained an entry nothing could ever reach.
            const p = post({ caption: "Shot by me", mentions: [] });
            const out = verifyClaims(
                { credits: [credit({ subject: "me", isHandle: false, role: "Shot by", quote: "Shot by me" })], statements: [] },
                [p], ARTIST, HANDLE);
            expect(out.credits).toHaveLength(1);
            expect(out.credits[0].isSelf).toBe(true);
        });

        it("marks first-person stand-ins like 'moi' as self", () => {
            // Real caption: "Produced/directed/edited by moi". Without this,
            // the artist becomes a collaborator of a person named Moi.
            const p = post({ caption: "Produced/directed/edited by moi", mentions: [] });
            const out = verifyClaims(
                { credits: [credit({ subject: "moi", isHandle: false, role: "Produced/directed/edited by", quote: "Produced/directed/edited by moi" })], statements: [] },
                [p], ARTIST, HANDLE);
            expect(out.credits[0].isSelf).toBe(true);
        });
    });

    describe("roles that say nothing", () => {
        it("drops an emoji-only role", () => {
            const p = post({ caption: "📸 @bevelcut_shawti", mentions: ["bevelcut_shawti"] });
            const out = verifyClaims(
                { credits: [credit({ subject: "bevelcut_shawti", role: "📸", quote: "📸 @bevelcut_shawti" })], statements: [] },
                [p], ARTIST, HANDLE);
            expect(out.credits).toHaveLength(0);
        });

        it("drops a role that is a clause rather than a job", () => {
            // Real output from a real feed. A role is a job; this is a sentence
            // about a relationship, and as a label on a graph edge it says
            // nothing.
            const caption = "Thank you @p00ls_ for helping artists explore ways to reward communities on-chain.";
            const p = post({ caption, mentions: ["p00ls_"] });
            const out = verifyClaims(
                { credits: [credit({ subject: "p00ls_", role: "helping artists explore ways to reward communities on-chain", quote: caption })], statements: [] },
                [p], ARTIST, HANDLE);
            expect(out.credits).toHaveLength(0);
        });

        it("drops a role written in the first person, which is narration not a credit", () => {
            const caption = "@subvertworld is a co-op music platform I joined as a founding member";
            const p = post({ caption, mentions: ["subvertworld"] });
            const out = verifyClaims(
                { credits: [credit({ subject: "subvertworld", role: "platform I joined", quote: caption })], statements: [] },
                [p], ARTIST, HANDLE);
            expect(out.credits).toHaveLength(0);
        });

        it("keeps the real credits that motivated the bound", () => {
            for (const [role, caption] of [
                ["Mixing & Mastering Engineer", "Mixing & Mastering Engineer: @p3t3rango"],
                ["Mastered by", "Mastered by @p3t3rango"],
                ["on guitar", "on guitar @p3t3rango"],
                ["Bass", "Bass @p3t3rango"],
            ] as const) {
                const p = post({ caption, mentions: ["p3t3rango"] });
                const out = verifyClaims({ credits: [credit({ role, quote: caption })], statements: [] }, [p], ARTIST, HANDLE);
                expect(out.credits.map(c => c.role)).toEqual([role]);
            }
        });

        it("drops a role that is only a preposition", () => {
            const p = post({ caption: "for @ap0cene", mentions: ["ap0cene"] });
            const out = verifyClaims(
                { credits: [credit({ subject: "ap0cene", role: "for", quote: "for @ap0cene" })], statements: [] },
                [p], ARTIST, HANDLE);
            expect(out.credits).toHaveLength(0);
        });
    });

    describe("statements", () => {
        it("keeps a quote that is in the caption", () => {
            const out = verifyClaims(
                { credits: [], statements: [{ quote: "Enjoy 💚", topic: "release day", url: POST_URL }] },
                [post()], ARTIST, HANDLE);
            expect(out.statements).toEqual([{ quote: "Enjoy 💚", topic: "release day", url: POST_URL }]);
        });

        it("drops a paraphrase", () => {
            const out = verifyClaims(
                { credits: [], statements: [{ quote: "He hopes listeners enjoy it", topic: "release day", url: POST_URL }] },
                [post()], ARTIST, HANDLE);
            expect(out.statements).toHaveLength(0);
        });

        it("drops a statement with no topic", () => {
            const out = verifyClaims(
                { credits: [], statements: [{ quote: "Enjoy 💚", topic: "", url: POST_URL }] },
                [post()], ARTIST, HANDLE);
            expect(out.statements).toHaveLength(0);
        });
    });
});

describe("creditedCollaborators", () => {
    it("never draws an edge from the artist to themselves", () => {
        const extraction = verifyClaims(
            {
                credits: [
                    credit(),
                    credit({ subject: "Pharaoh Sistare", isHandle: false, role: "Written & Produced by", quote: "Written & Produced by: Pharaoh Sistare" }),
                ],
                statements: [],
            },
            [post()], ARTIST, HANDLE);

        expect(creditedCollaborators(extraction).map(c => c.subject)).toEqual(["p3t3rango"]);
        expect(selfCredits(extraction).map(c => c.role)).toEqual(["Written & Produced by"]);
    });

    it("reports each self-credit once, however often the artist signs off with it", () => {
        const p2 = post({ url: OTHER_URL, platformPostId: "2", caption: "Producer: Pharaoh Sistare" });
        const p3 = post({ url: "https://www.instagram.com/p/THIRD/", platformPostId: "3", caption: "Producer: Pharaoh Sistare" });
        const extraction = verifyClaims(
            {
                credits: [
                    credit({ url: OTHER_URL, subject: "Pharaoh Sistare", isHandle: false, role: "Producer", quote: "Producer: Pharaoh Sistare" }),
                    credit({ url: "https://www.instagram.com/p/THIRD/", subject: "Pharaoh Sistare", isHandle: false, role: "producer", quote: "Producer: Pharaoh Sistare" }),
                ],
                statements: [],
            },
            [p2, p3], ARTIST, HANDLE);
        expect(selfCredits(extraction)).toHaveLength(1);
    });

    it("merges every role a person has been given, across posts", () => {
        const p1 = post();
        const p2 = post({ url: OTHER_URL, platformPostId: "2", caption: "Mixed by @p3t3rango" });
        const extraction = verifyClaims(
            {
                credits: [
                    credit(),
                    credit({ url: OTHER_URL, role: "Mixed by", quote: "Mixed by @p3t3rango" }),
                ],
                statements: [],
            },
            [p1, p2], ARTIST, HANDLE);

        const [c] = creditedCollaborators(extraction);
        expect(c.subject).toBe("p3t3rango");
        expect(c.roles).toEqual(["Mixing & Mastering Engineer", "Mixed by"]);
        expect(c.evidenceUrls).toEqual([POST_URL, OTHER_URL]);
    });

    it("ranks by how many posts credit each person", () => {
        const p2 = post({ url: OTHER_URL, platformPostId: "2", caption: "Shot by @shesjasminmarie and mixed by @p3t3rango", mentions: ["shesjasminmarie", "p3t3rango"] });
        const extraction = verifyClaims(
            {
                credits: [
                    credit(),
                    credit({ url: OTHER_URL, role: "mixed by", quote: "mixed by @p3t3rango" }),
                    credit({ url: OTHER_URL, subject: "shesjasminmarie", role: "Shot by", quote: "Shot by @shesjasminmarie" }),
                ],
                statements: [],
            },
            [post(), p2], ARTIST, HANDLE);

        expect(creditedCollaborators(extraction).map(c => c.subject)).toEqual(["p3t3rango", "shesjasminmarie"]);
    });
});

describe("captionBearingPosts", () => {
    it("never reads a caption somebody else wrote", () => {
        const foreign = post({ isOwnPost: false, ownerUsername: "someoneelse" });
        expect(captionBearingPosts([foreign])).toHaveLength(0);
    });

    it("skips a caption that is only hashtags and dot-padding", () => {
        const dump = post({ caption: "\n.\n.\n.\n.\n#indiepop #altpop #musicdiscovery #christmassong #popmusician" });
        expect(captionBearingPosts([dump])).toHaveLength(0);
    });

    it("keeps a short credit line, which is the whole point", () => {
        // 23 characters. An earlier threshold of 25 discarded this, which is a
        // real credit from a real feed.
        const short = post({ caption: "Shot by @moneaofthemoon", mentions: ["moneaofthemoon"] });
        expect(captionBearingPosts([short])).toHaveLength(1);
    });

    it("keeps a real caption", () => {
        expect(captionBearingPosts([post()])).toHaveLength(1);
    });
});

describe("roleIsSomebodyElsesHandle — co-presence is not employment", () => {
    const subject = async () => (await import("../socialCredits")).roleIsSomebodyElsesHandle;

    it.each([
        // The one that started it: three people who went somewhere together,
        // each given the venue as their job.
        ["breath church", "zavodskyalan",
         "Then I went to NY to do my very first @breath.church @physiologicnyc with @sage.breath and the boys @thegreatzandini & @zavodskyalan"],
        ["first @breath.church", "sage.breath",
         "Then I went to NY to do my very first @breath.church with @sage.breath"],
        ["KIKI used for WNBA pack", "bycherele",
         "So apparently @bycherele KIKI is being used for @wnba Legendary In Her Bag @nbatopshot Pack Opening"],
        ["opening up for @travisscott", "whoisoyabun",
         "@whoisoyabun opening up for @travisscott"],
    ])("rejects %s", async (role, subj, quote) => {
        expect(await (await subject())(role, subj, quote)).toBeTruthy();
    });

    it.each([
        ["Mixed by", "p3t3rango", "Mixed by @p3t3rango"],
        ["main production partner", "zavodskyalan", "@zavodskyalan has been one of my main production partners"],
        ["added some 808s", "zavodskyalan", "Alan had added some 808s for the outro but those files were lost"],
        ["on guitar", "someone", "@someone on guitar"],
        // The subject's OWN handle inside the role is fine — "feat @x" is how
        // a feature is written.
        ["feat @dameatlas", "dameatlas", "feat @dameatlas on the second verse"],
    ])("keeps %s", async (role, subj, quote) => {
        expect(await (await subject())(role, subj, quote)).toBeNull();
    });

    it("rejects an unrelated handle that merely contains the subject's name", async () => {
        // A containment exemption was added here so a bare display name
        // ("Alan") would not treat its own handle ("@zavodskyalan") as
        // somebody else's. It was reverted: containment cannot tell that two
        // overlapping strings are the same PERSON, so subject "Cole" would
        // have exempted an unrelated @davidcole, and a four-character floor is
        // no protection for Dave, Anna, Sean, Kyle.
        //
        // Measured before reverting: across all 714 stored credit rows the
        // containment branch fired ZERO times. It rescued nothing and opened
        // the hole this function exists to close.
        expect(await (await subject())(
            "the @davidcole session", "Cole", "the @davidcole session with @Cole")).toBe("davidcole");
    });

    it("keeps the subject's own handle inside a role", async () => {
        // Exact equality still covers the ordinary case, which is how a
        // feature is written.
        expect(await (await subject())("feat @dameatlas", "dameatlas", "feat @dameatlas")).toBeNull();
    });

    it("KNOWN LIMITATION: a bare name whose own handle is in the role is rejected", async () => {
        // The cost of reverting the exemption, pinned so it is a decision
        // rather than a surprise. Measured absent from every stored credit row
        // we have; if it ever shows up in real data, that measurement is the
        // thing to redo.
        expect(await (await subject())(
            "feat @zavodskyalan", "Alan", "feat @zavodskyalan on the second verse")).toBe("zavodskyalan");
    });

    it("ignores handles too short to be distinctive", async () => {
        // A three-character handle folds into ordinary words and would reject
        // half the real roles in the table.
        expect(await (await subject())("on drums", "someone", "@abc @someone on drums")).toBeNull();
    });
});
