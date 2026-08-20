import {
    buildCanonicalArtistUrl,
    MAX_ARTIST_PROFILE_URL_LENGTH,
    parseSupportedArtistUrl,
    type SupportedArtistPlatform,
} from "../artistProfileUrl";

describe("parseSupportedArtistUrl", () => {
    it.each([
        [
            "https://open.spotify.com/artist/2TNJWBi73MnkSRkZRPBqSW?si=tracking#popular",
            { id: "2TNJWBi73MnkSRkZRPBqSW", platform: "spotify" },
        ],
        [
            "  http://deezer.com/en-us/artist/12345/?utm_source=test#tracks  ",
            { id: "12345", platform: "deezer" },
        ],
        [
            "https://www.deezer.com/FR/artist/98765",
            { id: "98765", platform: "deezer" },
        ],
    ])("parses a supported artist URL: %s", (url, expected) => {
        expect(parseSupportedArtistUrl(url)).toEqual(expected);
    });

    it.each([
        "https://open.spotify.com.evil.example/artist/abc123",
        "https://www.open.spotify.com/artist/abc123",
        "https://deezer.com.evil.example/artist/123",
        "https://user@open.spotify.com/artist/abc123",
        "https://open.spotify.com:8443/artist/abc123",
        "http://open.spotify.com/artist/abc123",
        "https://open.spotify.com/track/abc123",
        "https://open.spotify.com/artist/abc123/albums",
        "https://www.deezer.com/artist/not-numeric",
        "https://www.deezer.com/en/artist/123/tracks",
        "https://www.deezer.com/english/artist/123",
    ])("rejects an unsupported host, authority, protocol, or path: %s", (url) => {
        expect(parseSupportedArtistUrl(url)).toBeNull();
    });

    it("rejects an artist URL over the shared maximum length", () => {
        const oversized = `https://open.spotify.com/artist/${"a".repeat(MAX_ARTIST_PROFILE_URL_LENGTH)}`;
        expect(parseSupportedArtistUrl(oversized)).toBeNull();
    });
});

describe("buildCanonicalArtistUrl", () => {
    it.each([
        ["spotify", "2TNJWBi73MnkSRkZRPBqSW", "https://open.spotify.com/artist/2TNJWBi73MnkSRkZRPBqSW"],
        ["deezer", "12345", "https://www.deezer.com/artist/12345"],
    ] as const)("builds a canonical %s artist URL", (platform, id, expected) => {
        expect(buildCanonicalArtistUrl(platform, id)).toBe(expected);
    });

    it.each([
        ["spotify", "id-with-punctuation"],
        ["deezer", "dz123"],
        ["youtube" as SupportedArtistPlatform, "123"],
    ])("rejects an invalid %s artist ID", (platform, id) => {
        expect(buildCanonicalArtistUrl(platform as SupportedArtistPlatform, id)).toBeNull();
    });

    it("does not construct a URL over the shared maximum length", () => {
        expect(buildCanonicalArtistUrl(
            "spotify",
            "a".repeat(MAX_ARTIST_PROFILE_URL_LENGTH),
        )).toBeNull();
    });
});
