/**
 * Ranking, not filtering. Every case here is a source that PASSES verification;
 * the only question is what an artist should see first.
 */
import { sourceAuthority, byAuthority, AUTHORITY } from "@/lib/sourceAuthority";

describe("sourceAuthority", () => {
    it("puts a credits database above an aggregator profile", () => {
        // The case that prompted this: both are genuinely about Pete Rango and
        // only one records work he actually did.
        const discogs = sourceAuthority("https://www.discogs.com/artist/123-Pete-Rango", "profile");
        const clubhouse = sourceAuthority("https://clubhousedb.com/user/peterango", "profile");
        expect(discogs).toBeGreaterThan(clubhouse);
    });

    it("puts editorial coverage at the top", () => {
        expect(sourceAuthority("https://voyagemia.com/interview/meet-peter-rango", "interview"))
            .toBe(AUTHORITY.EDITORIAL);
    });

    it("treats an unrecognised publication as unknown, not as junk", () => {
        // A ranking built from a list of publications we have heard of would
        // bury a local zine beneath a scraper.
        const zine = sourceAuthority("https://some-small-zine.example/feature", "profile");
        expect(zine).toBe(AUTHORITY.UNKNOWN);
        expect(zine).toBeGreaterThan(sourceAuthority("https://clubhousedb.com/user/x", "profile"));
    });

    it("ranks the artist's own site above their streaming pages", () => {
        expect(sourceAuthority("https://peterango.com", "website", { ownDomain: true }))
            .toBeGreaterThan(sourceAuthority("https://open.spotify.com/artist/abc", "audio"));
    });

    it("orders a real vault best-first and keeps ties stable", () => {
        const vault = [
            { url: "https://clubhousedb.com/user/peterango", type: "profile" },
            { url: "https://open.spotify.com/playlist/abc", type: "audio" },
            { url: "https://voyagemia.com/interview/meet-peter-rango", type: "interview" },
            { url: "https://www.discogs.com/release/1-Nia-Sultana", type: "profile" },
            { url: "https://lifechangesnetwork.com/music-producer-pete-rango", type: "interview" },
        ];
        expect(byAuthority(vault, s => s).map(s => new URL(s.url).hostname.split(".").slice(-2)[0]))
            .toEqual(["voyagemia", "lifechangesnetwork", "discogs", "spotify", "clubhousedb"]);
    });

    it("never drops anything", () => {
        const vault = [{ url: "https://clubhousedb.com/user/x", type: "profile" }];
        expect(byAuthority(vault, s => s)).toHaveLength(1);
    });
});
