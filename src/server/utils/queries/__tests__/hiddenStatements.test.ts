// @ts-nocheck
/**
 * An artist saying "don't use that".
 *
 * The case that prompted it: Pete Rango's memorial post for his cousin André
 * produced four statements, one about the records André gave him and three
 * about his death. A fan asking the ask box could get the latter back.
 */
import { jest } from "@jest/globals";

describe("getSocialCredits and hidden statements", () => {
    beforeEach(() => { jest.resetModules(); });

    async function setup(rows, hiddenBehaviour) {
        const { db } = await import("@/server/db/drizzle");
        // db.select() is used for both the credits read and the hidden read, in
        // that order, so the mock answers by call.
        let call = 0;
        db.select = jest.fn(() => {
            const which = call++;
            return {
                from: () => ({
                    where: async () => {
                        if (which === 0) return rows;
                        return hiddenBehaviour();
                    },
                }),
            };
        });
        return await import("@/server/utils/queries/socialCreditQueries");
    }

    const statement = (quote, label = "a topic") => ({
        kind: "statement", quote, label, sourceUrl: "https://insta/p/1",
        subject: null, isHandle: false, isSelf: false, postedAt: null,
    });
    const credit = (subject) => ({
        kind: "credit", quote: "q", label: "producer", sourceUrl: "https://insta/p/2",
        subject, isHandle: true, isSelf: false, postedAt: null,
    });

    it("drops a hidden passage and keeps the rest", async () => {
        // One post produced both: the records his cousin handed him, which is
        // origin story, and his death, which is not ours to repeat on request.
        const q = "André was a very troubled soul.";
        const hiddenNorm = "andrewasaverytroubledsoul";
        const mod = await setup(
            [statement(q, "remembering his cousin"), statement("He handed me 112's Part III.", "musical influence")],
            () => [{ q: hiddenNorm }],
        );
        const out = await mod.getSocialCredits("a1");
        expect(out.statements.map(s => s.topic)).toEqual(["musical influence"]);
    });

    it("matches when a later re-read re-punctuates or drops the accent", async () => {
        // A full re-read clears and rewrites the table, so the exclusion is
        // keyed on the quote — and the model does not always keep the comma,
        // or the é.
        const mod = await setup(
            [statement("André was a very troubled soul!")],
            () => [{ q: "andrewasaverytroubledsoul" }],   // stored without the accent
        );
        const out = await mod.getSocialCredits("a1");
        expect(out.statements).toHaveLength(0);
    });

    it("withholds every statement when it cannot read what is hidden", async () => {
        // Serving one we were supposed to be hiding is the failure this exists
        // to prevent, so an unreadable list means none of them go out.
        const mod = await setup(
            [statement("something"), credit("dameatlas")],
            () => { const e = new Error("connection lost"); throw e; },
        );
        const out = await mod.getSocialCredits("a1");
        expect(out.statements).toHaveLength(0);
        // Credits still go — a role on a record is not the artist talking
        // about their life.
        expect(out.credits).toHaveLength(1);
    });

    it("serves statements normally before the table exists", async () => {
        // Migrations here are applied by hand through Supabase, so this ships
        // before the table does. Until then nothing CAN be hidden, and an
        // empty set is the truth rather than a guess.
        const mod = await setup(
            [statement("something")],
            () => { const e = new Error('relation "artist_hidden_statements" does not exist'); e.code = "42P01"; throw e; },
        );
        const out = await mod.getSocialCredits("a1");
        expect(out.statements).toHaveLength(1);
    });
});
