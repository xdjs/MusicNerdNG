/**
 * Ranking, tiering, and the one thing that does filter.
 *
 * Most cases here are sources that PASS verification and the only question is
 * what an artist should see first. The blocked-host cases are the exception:
 * those never reach the vault at all.
 */
import { sourceAuthority, byAuthority, AUTHORITY, isBlockedSourceHost, sourceTier } from "@/lib/sourceAuthority";

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

describe("blocked hosts", () => {
    it("keeps Boomplay out, in both the shapes it arrived in", () => {
        // Readable and genuinely about the artist, so the judge affirmed it;
        // and unreadable but titled with his full name, so it passed as a lead.
        // Neither route survives a host check.
        expect(isBlockedSourceHost("https://www.boomplay.com/artists/20993709")).toBe(true);
        expect(isBlockedSourceHost("https://boomplay.com/songs/12345")).toBe(true);
        expect(isBlockedSourceHost("https://m.boomplay.com/artists/1")).toBe(true);
    });

    it("blocks the other scrape farms already seen in vaults", () => {
        for (const url of [
            "https://www.viberate.com/artist/pharaoh-sistare",
            "https://soundcharts.com/en/artist/f3b91dc2",
            "https://clubhousedb.com/user/peterango",
            "https://kworb.net/spotify/artist/abc.html",
            "https://socialblade.com/youtube/user/x",
        ]) expect(isBlockedSourceHost(url)).toBe(true);
    });

    it("leaves real publications, credits databases and stores alone", () => {
        // The failure to avoid is a blocklist that grows into a filter. Blocking
        // is for sites with no author, not for sites we have not heard of.
        for (const url of [
            "https://www.theguardian.com/music/2026/jan/01/feature",
            "https://www.discogs.com/artist/123-Pete-Rango",
            "https://www.allmusic.com/artist/kaskade",
            "https://petergango.bandcamp.com/album/x",
            "https://open.spotify.com/artist/abc",
            "https://some-small-zine.example/feature",
            "https://www.instagram.com/p3t3rango/",
        ]) expect(isBlockedSourceHost(url)).toBe(false);
    });

    it("says no rather than throwing on a URL it cannot parse", () => {
        expect(isBlockedSourceHost("not a url")).toBe(false);
        expect(isBlockedSourceHost("")).toBe(false);
    });

    it("does not block a host merely because it looks like one", () => {
        // Substring matching would block boomplay.com.evil.example and
        // notboomplay.com alike. The first is a different site; the second is
        // somebody else's.
        expect(isBlockedSourceHost("https://boomplay.com.evil.example/x")).toBe(false);
        expect(isBlockedSourceHost("https://notboomplay.com/x")).toBe(false);
    });
});

describe("tiers, which the relevance judge is told about", () => {
    it("calls coverage, credits, an own site and an own feed preferred", () => {
        expect(sourceTier("https://voyagemia.com/interview/x", "interview")).toBe("preferred");
        expect(sourceTier("https://www.discogs.com/artist/1", "profile")).toBe("preferred");
        expect(sourceTier("https://peterango.com", "website", { ownDomain: true })).toBe("preferred");
        expect(sourceTier("https://www.instagram.com/p3t3rango/", "profile")).toBe("preferred");
    });

    it("calls an unplaceable page and a store page unknown", () => {
        // Unknown is the safe middle: the judge reads the page and decides,
        // exactly as before the tiers existed. An unfamiliar host whose page IS
        // an interview still ranks as editorial, which is the existing rule and
        // the reason a local zine is not buried under a scraper.
        expect(sourceTier("https://some-small-zine.example/x", "profile")).toBe("unknown");
        expect(sourceTier("https://some-small-zine.example/feature", "article")).toBe("preferred");
        expect(sourceTier("https://open.spotify.com/artist/abc", "audio")).toBe("unknown");
    });

    it("calls a scraped directory low-signal", () => {
        expect(sourceTier("https://last.fm/user/someone", "profile")).toBe("low-signal");
    });
});

