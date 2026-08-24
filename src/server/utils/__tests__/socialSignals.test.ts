// @ts-nocheck
import { deriveSocialSignals, selectRecentPosts } from "@/server/utils/socialSignals";
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

        it("standoutPosts only ever cite the artist's own post URLs", () => {
            const ownUrls = new Set(IG_FIXTURE_POSTS.filter(p => p.isOwnPost).map(p => p.url));
            for (const s of signals.standoutPosts) expect(ownUrls.has(s.url)).toBe(true);
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
        for (const r of signals.musicReferences) expect(r.evidenceUrls.length).toBeGreaterThan(0);
    });
});

describe("musicReferences — third-party audio must never look like the artist's own work (regression, see signal-integrity-report.md)", () => {
    // Real fixture data: the "Las Empanadas" / "Los Caracuchos" post is the
    // exact defect the product owner caught live — a themed-food-recipe post
    // that merely used a trending third-party track as background audio.
    // With the artist's real name supplied, it must never surface as a music
    // signal, and every kept reference must cite only the post(s) that
    // actually carry that exact title+artist credit.
    const signals = deriveSocialSignals(IG_FIXTURE_POSTS, HANDLE, "Pete Rango");

    it("drops a track credited to someone else entirely (Las Empanadas / Los Caracuchos)", () => {
        expect(signals.musicReferences.find(m => m.title === "Las Empanadas")).toBeUndefined();
    });

    it("drops a track credited to another artist by name (Signals / Brian Eno)", () => {
        expect(signals.musicReferences.find(m => m.title === "Signals")).toBeUndefined();
    });

    it("keeps a track co-credited to the artist by name, citing only the post that carries it", () => {
        const offTheLeash = signals.musicReferences.find(m => m.title === "OFF THE LEASH");
        expect(offTheLeash).toBeDefined();
        expect(offTheLeash.artist).toBe("LIL LIL, Pete Rango");
        expect(offTheLeash.evidenceUrls).toEqual(["https://www.instagram.com/p/DBOZIlHRpcx/"]);
    });

    it("keeps a remix credited to the artist even when posted by a collaborator, not the artist themselves", () => {
        const remix = signals.musicReferences.find(m => m.title === "crying on the floor (pete rango mix)");
        expect(remix).toBeDefined();
        expect(remix.artist).toBe("Dame Atlas, Pete Rango");
    });
});

describe("deriveSocialSignals — synthetic edge cases", () => {
    it("returns all-empty signals for an empty post list", () => {
        const signals = deriveSocialSignals([], HANDLE);
        expect(signals).toEqual({
            collaborators: [], mentionedAccounts: [], themes: [],
            standoutPosts: [], musicReferences: [],
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

describe("deriveThemes — distinctiveness (word-frequency artifacts vs. real signal)", () => {
    function ownPost(i: number, caption: string, hashtags: string[] = []): Record<string, unknown> {
        return {
            platform: "instagram", platformPostId: String(i), ownerUsername: HANDLE, isOwnPost: true,
            caption, url: `https://www.instagram.com/p/own${i}/`, postedAt: `2026-01-0${i}T00:00:00.000Z`,
            likeCount: 10, commentCount: 1, playCount: null, hashtags, mentions: [],
            coauthors: [], musicTitle: null, musicArtist: null,
        };
    }

    it("excludes a generic reflexive/filler word even when it recurs — a word-frequency artifact is not a theme", () => {
        // "myself" and "just" repeat across all 5 own posts — real, high
        // frequency, zero content. Every other word is unique per post (count
        // 1), so NOTHING should clear the bar: an empty themes list, not a
        // weak one, is the correct output here (spec: fewer, sharper signals
        // beats padding).
        const posts = [
            ownPost(1, "just doing this for myself alone"),
            ownPost(2, "myself and just being honest today"),
            ownPost(3, "only myself, just me and the music"),
            ownPost(4, "myself again just testing"),
            ownPost(5, "just myself, nothing else really"),
        ];
        const signals = deriveSocialSignals(posts, HANDLE);
        expect(signals.themes).toEqual([]);
    });

    it("keeps a distinctive proper-noun-style term (capitalized mid-caption) at the normal low bar", () => {
        const posts = [
            ownPost(1, "Playing in Colombia tonight"),
            ownPost(2, "Back in Colombia again"),
        ];
        const signals = deriveSocialSignals(posts, HANDLE);
        const colombia = signals.themes.find(t => t.term === "colombia");
        expect(colombia).toBeDefined();
        expect(colombia.kind).toBe("caption_term");
        expect(colombia.count).toBe(2);
    });

    it("keeps a repeated multi-word phrase at the normal low bar, even though neither word alone clears the generic-word bar", () => {
        const posts = [
            ownPost(1, "house is a black church on a tuesday night"),
            ownPost(2, "nothing like a black church energy on a good set"),
        ];
        const signals = deriveSocialSignals(posts, HANDLE);
        const phrase = signals.themes.find(t => t.term === "black church");
        expect(phrase).toBeDefined();
        expect(phrase.kind).toBe("caption_phrase");
        expect(phrase.count).toBe(2);
        // Neither "black" nor "church" alone clears the generic-word bar (2 < 5).
        expect(signals.themes.some(t => t.term === "black" && t.kind === "caption_term")).toBe(false);
        expect(signals.themes.some(t => t.term === "church" && t.kind === "caption_term")).toBe(false);
    });
});



describe("selectRecentPosts — the 2020 bug", () => {
    const NOW = Date.parse("2026-08-21T00:00:00Z");
    const post = (iso, id) => ({
        platform: "instagram", platformPostId: id, ownerUsername: "p3t3rango", isOwnPost: true,
        caption: `post ${id}`, url: `https://instagram.com/p/${id}`, postedAt: iso,
        likeCount: 10, commentCount: 1, playCount: null, hashtags: [], mentions: [],
        coauthors: [], musicTitle: null, musicArtist: null,
    });

    it("drops posts outside the window when there is plenty of recent activity", () => {
        // postedAt was stored from the start and used by nothing — no sort, no
        // window — so a 2020 post competed with last week's. Two different
        // artists were asked to reflect on years-old posts; the second one's
        // reaction was "how is it relevant now?".
        const recent = Array.from({ length: 40 }, (_, i) => post(`2026-06-${String(i % 28 + 1).padStart(2, "0")}T00:00:00Z`, `r${i}`));
        const ancient = Array.from({ length: 40 }, (_, i) => post("2020-03-01T00:00:00Z", `a${i}`));
        const picked = selectRecentPosts([...ancient, ...recent], NOW);
        expect(picked).toHaveLength(40);
        expect(picked.every(p => p.postedAt.startsWith("2026"))).toBe(true);
    });

    it("falls back to the FULL history when recent activity is thin, not an arbitrary slice", () => {
        // An artist who posts rarely must still get questions, and truncating
        // their history to a fixed count would lose real signal for nothing.
        const old = Array.from({ length: 5 }, (_, i) => post(`201${i + 4}-01-01T00:00:00Z`, `o${i}`));
        const picked = selectRecentPosts(old, NOW);
        expect(picked).toHaveLength(5);
        expect(picked[0].postedAt.startsWith("2018")).toBe(true); // newest first
    });

    it("sorts undated posts last without discarding them", () => {
        const dated = post("2026-01-01T00:00:00Z", "d");
        const undated = { ...post("", "u"), postedAt: "" };
        const picked = selectRecentPosts([undated, dated], NOW);
        expect(picked[0].platformPostId).toBe("d");
        expect(picked).toHaveLength(2);
    });
});
