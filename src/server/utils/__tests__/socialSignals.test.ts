// @ts-nocheck
import { deriveSocialSignals } from "@/server/utils/socialSignals";
import { IG_FIXTURE_POSTS } from "@/server/utils/__fixtures__/socialPosts.fixture";

const HANDLE = "p3t3rango";

describe("deriveSocialSignals — real fixture (300-post Apify scrape, curated subset)", () => {
    const signals = deriveSocialSignals(IG_FIXTURE_POSTS, HANDLE);

    describe("collaborators", () => {
        it("ranks the top real collaborator (@dameatlas) first, combining coauthor-tagged AND foreign-owner posts", () => {
            // 6 posts owned by dameatlas + 1 own post tagging dameatlas as coauthor = 7.
            const dameatlas = signals.collaborators.find(c => c.handle === "dameatlas");
            expect(dameatlas).toBeDefined();
            expect(dameatlas.postCount).toBe(7);
            expect(signals.collaborators[0].handle).toBe("dameatlas");
        });

        it("never lists the artist's own handle as their own collaborator", () => {
            expect(signals.collaborators.some(c => c.handle.toLowerCase() === HANDLE)).toBe(false);
        });

        it("every collaborator carries at least one real evidence URL, capped at 5", () => {
            for (const c of signals.collaborators) {
                expect(c.evidenceUrls.length).toBeGreaterThan(0);
                expect(c.evidenceUrls.length).toBeLessThanOrEqual(5);
                for (const url of c.evidenceUrls) expect(url).toMatch(/^https:\/\/www\.instagram\.com\/p\//);
            }
        });

        it("picks up lower-ranked real collaborators from both paths (owner + coauthors)", () => {
            const handles = signals.collaborators.map(c => c.handle);
            expect(handles).toEqual(expect.arrayContaining(["liv.corp", "rein.rocks", "deadsetfc", "soft_core.music", "dear_rod", "kevaux__"]));
        });
    });

    describe("own-words scoping (collab posts excluded)", () => {
        it("themes are derived only from the artist's own posts — a dameatlas-only hashtag never appears", () => {
            // #housemusic / #housemusiclovers appear only on dameatlas-owned (collab) posts in the fixture.
            const terms = signals.themes.map(t => t.term);
            expect(terms).not.toContain("housemusic");
            expect(terms).not.toContain("housemusiclovers");
        });

        it("a real recurring hashtag from the artist's OWN posts (midjourney) is captured with evidence", () => {
            const midjourney = signals.themes.find(t => t.term === "midjourney" && t.kind === "hashtag");
            expect(midjourney).toBeDefined();
            expect(midjourney.count).toBe(3);
            expect(midjourney.evidenceUrls.length).toBeGreaterThan(0);
        });

        it("mentionedAccounts is scoped to the artist's own posts only", () => {
            // dear_rod is mentioned on BOTH soft_core.music's 2 collab posts (2x) AND the
            // artist's own DWMCYp9kpd_ post (1x). If mentionedAccounts leaked collab-post
            // mentions in, this would read 3; scoped to own posts only, it must read 1.
            const dearRod = signals.mentionedAccounts.find(m => m.handle === "dear_rod");
            expect(dearRod).toBeDefined();
            expect(dearRod.count).toBe(1);
            expect(dearRod.evidenceUrls).toEqual(["https://www.instagram.com/p/DWMCYp9kpd_/"]);
        });

        it("standoutPosts and bursts only ever cite the artist's own post URLs", () => {
            const ownUrls = new Set(IG_FIXTURE_POSTS.filter(p => p.isOwnPost).map(p => p.url));
            for (const s of signals.standoutPosts) expect(ownUrls.has(s.url)).toBe(true);
            for (const b of signals.bursts) expect(ownUrls.has(b.topPostUrl)).toBe(true);
        });
    });

    describe("standout detection against median", () => {
        it("flags the real outlier posts at their real multiple of the real median", () => {
            const colombia = signals.standoutPosts.find(s => s.url === "https://www.instagram.com/p/DcD2TOMSCtE/");
            expect(colombia).toBeDefined();
            expect(colombia.metric).toBe("plays");
            expect(colombia.value).toBe(8144);
            expect(colombia.multiple).toBeGreaterThanOrEqual(3);

            const growth2020 = signals.standoutPosts.find(s => s.url === "https://www.instagram.com/p/CDEWSfpgzol/");
            expect(growth2020).toBeDefined();
            expect(growth2020.metric).toBe("likes");
            expect(growth2020.value).toBe(410);
            expect(growth2020.median).toBe(58);
            expect(growth2020.multiple).toBe(7.1);
        });

        it("does not flag an ordinary own post as a standout", () => {
            // DWMCYp9kpd_ has modest likes/plays relative to the fixture's own-post median.
            const ordinary = signals.standoutPosts.find(s => s.url === "https://www.instagram.com/p/DWMCYp9kpd_/");
            expect(ordinary).toBeUndefined();
        });
    });

    describe("bursts", () => {
        it("flags the real June 2018 posting cluster relative to the artist's own baseline", () => {
            const june2018 = signals.bursts.find(b => b.month === "2018-06");
            expect(june2018).toBeDefined();
            expect(june2018.postCount).toBe(4);
            expect(june2018.postCount).toBeGreaterThanOrEqual(june2018.baseline * 2);
        });
    });

    describe("musicReferences", () => {
        it("carries real title/artist credits with evidence, and never claims a collab track as the artist's own post", () => {
            const collabTrack = signals.musicReferences.find(m => m.title.toLowerCase().includes("crying on the floor"));
            expect(collabTrack).toBeDefined();
            expect(collabTrack.postedByOwn).toBe(false); // only ever seen on dameatlas-owned posts in this fixture
            expect(collabTrack.evidenceUrls.length).toBeGreaterThan(0);

            const ownTrack = signals.musicReferences.find(m => m.title === "Signals");
            expect(ownTrack).toBeDefined();
            expect(ownTrack.artist).toBe("Brian Eno");
            expect(ownTrack.postedByOwn).toBe(true);
        });
    });

    it("every signal item, across every category, carries at least one real post URL", () => {
        for (const c of signals.collaborators) expect(c.evidenceUrls.length).toBeGreaterThan(0);
        for (const m of signals.mentionedAccounts) expect(m.evidenceUrls.length).toBeGreaterThan(0);
        for (const t of signals.themes) expect(t.evidenceUrls.length).toBeGreaterThan(0);
        for (const s of signals.standoutPosts) expect(s.url).toBeTruthy();
        for (const b of signals.bursts) expect(b.topPostUrl).toBeTruthy();
        for (const r of signals.musicReferences) expect(r.evidenceUrls.length).toBeGreaterThan(0);
    });
});

describe("deriveSocialSignals — synthetic edge cases", () => {
    it("returns all-empty signals for an empty post list", () => {
        const signals = deriveSocialSignals([], HANDLE);
        expect(signals).toEqual({
            collaborators: [], mentionedAccounts: [], themes: [],
            standoutPosts: [], bursts: [], musicReferences: [],
        });
    });

    it("defensively drops the artist's own handle from collaborators even if a stored row still contains it", () => {
        // Real Apify coauthorProducers payloads DO include the artist themselves alongside a
        // real collaborator (verified against the raw scrape) — mapApifyPost filters this at
        // ingest, but signals must not depend on that; it re-derives safety independently.
        const posts = [
            {
                platform: "instagram", platformPostId: "1", ownerUsername: "soft_core.music", isOwnPost: false,
                caption: "collab drop", url: "https://www.instagram.com/p/dirtyrow/", postedAt: "2026-01-01T00:00:00.000Z",
                likeCount: 10, commentCount: 1, playCount: null, hashtags: [], mentions: [],
                coauthors: ["p3t3rango", "dear_rod"], // includes self, pre-filter
                musicTitle: null, musicArtist: null,
            },
        ];
        const signals = deriveSocialSignals(posts, HANDLE);
        expect(signals.collaborators.some(c => c.handle.toLowerCase() === HANDLE)).toBe(false);
        expect(signals.collaborators.find(c => c.handle === "dear_rod")).toBeDefined();
        // The owner (soft_core.music) is also a collaborator via the "foreign owner" path.
        expect(signals.collaborators.find(c => c.handle === "soft_core.music")).toBeDefined();
    });

    it("requires at least 5 own posts with a positive metric before computing a median (no false standouts on thin data)", () => {
        const posts = [1, 2, 3].map(i => ({
            platform: "instagram", platformPostId: String(i), ownerUsername: HANDLE, isOwnPost: true,
            caption: "post", url: `https://www.instagram.com/p/thin${i}/`, postedAt: "2026-01-0" + i + "T00:00:00.000Z",
            likeCount: i === 1 ? 1000 : 5, commentCount: 0, playCount: null, hashtags: [], mentions: [],
            coauthors: [], musicTitle: null, musicArtist: null,
        }));
        const signals = deriveSocialSignals(posts, HANDLE);
        expect(signals.standoutPosts).toEqual([]);
    });

    it("requires at least 3 distinct own-post months before computing a burst baseline", () => {
        const posts = [1, 2, 3, 4].map(i => ({
            platform: "instagram", platformPostId: String(i), ownerUsername: HANDLE, isOwnPost: true,
            caption: "post", url: `https://www.instagram.com/p/samemonth${i}/`, postedAt: "2026-01-0" + i + "T00:00:00.000Z",
            likeCount: 10, commentCount: 0, playCount: null, hashtags: [], mentions: [],
            coauthors: [], musicTitle: null, musicArtist: null,
        }));
        const signals = deriveSocialSignals(posts, HANDLE);
        expect(signals.bursts).toEqual([]); // only one distinct month present
    });

    it("a collaborator with a single real post still surfaces, ranked, with its evidence URL", () => {
        const posts = [
            {
                platform: "instagram", platformPostId: "1", ownerUsername: "onefeature", isOwnPost: false,
                caption: "feature", url: "https://www.instagram.com/p/onefeat/", postedAt: "2026-01-01T00:00:00.000Z",
                likeCount: 3, commentCount: 0, playCount: null, hashtags: [], mentions: [],
                coauthors: [], musicTitle: null, musicArtist: null,
            },
        ];
        const signals = deriveSocialSignals(posts, HANDLE);
        expect(signals.collaborators).toEqual([
            { handle: "onefeature", postCount: 1, evidenceUrls: ["https://www.instagram.com/p/onefeat/"] },
        ]);
    });
});
