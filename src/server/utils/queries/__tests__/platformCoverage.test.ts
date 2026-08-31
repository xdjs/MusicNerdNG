// @ts-nocheck
/**
 * The lists that decide what discovery knows about.
 *
 * They fell nineteen platforms behind urlmap without anybody noticing —
 * discogs on 22,862 artists, wikipedia on 7,606, linktree on 2,238 — so an
 * artist's own Linktree could be filed as press about them.
 *
 * The drift-versus-urlmap check needs the real table and lives in
 * scripts/check-platform-coverage.ts. These are the invariants that hold
 * without a database, so CI can enforce them.
 */
import {
    PROFILE_LINK_COLUMNS,
    PLATFORM_DOMAINS,
    IDENTITY_ANCHOR_COLUMNS,
} from "@/server/utils/queries/vaultWebSearch";
import { artistRowProperty } from "@/server/db/artistRowProperties";
import { artists } from "@/server/db/schema";

describe("platform classification", () => {
    it("gives every known profile column a domain", () => {
        // Without one, isKnownProfileUrl silently contributes nothing for that
        // platform — a widening that looks done and does nothing, which is the
        // failure this whole change exists to fix.
        const missing = PROFILE_LINK_COLUMNS.filter(c => !PLATFORM_DOMAINS[c]?.length);
        expect(missing).toEqual([]);
    });

    it("keeps every identity anchor inside the known profile columns", () => {
        const stray = IDENTITY_ANCHOR_COLUMNS.filter(c => !PROFILE_LINK_COLUMNS.includes(c));
        expect(stray).toEqual([]);
    });

    it("keeps opaque identifiers out of the identity anchor", () => {
        // mentionDensity treats every identifier as a handle to count in a
        // page's paragraphs. discogs is "1967268" and facebookID is
        // "399778650221956"; any page containing that digit string would read
        // as being about the artist. imdb is "nm8483808", which is not a name.
        for (const opaque of ["discogs", "facebookID", "imdb"]) {
            expect(PROFILE_LINK_COLUMNS).toContain(opaque);      // known for the skip check
            expect(IDENTITY_ANCHOR_COLUMNS).not.toContain(opaque); // never as evidence of who
        }
    });

    it("keeps wallet identities out of the identity anchor", () => {
        // ".eth" in a paragraph says nothing about whose page it is.
        for (const wallet of ["mirror", "zora", "lens", "farcaster"]) {
            expect(IDENTITY_ANCHOR_COLUMNS).not.toContain(wallet);
        }
    });

    it("knows the platforms it was blind to", () => {
        for (const platform of ["discogs", "wikipedia", "imdb", "linktree", "bandsintown"]) {
            expect(PROFILE_LINK_COLUMNS).toContain(platform);
        }
    });

    it("does not narrow spotify or bandcamp to the host their url template implies", () => {
        // Deriving these from urlmap gives "open.spotify.com" — narrower than
        // the bare domain and no longer matching it — and "x.bandcamp.com",
        // because the template is "%@.bandcamp.com". Derivation would have
        // shipped a subtler version of the bug it was meant to fix.
        expect(PLATFORM_DOMAINS.spotify).toContain("spotify.com");
        expect(PLATFORM_DOMAINS.bandcamp).toContain("bandcamp.com");
    });

    it("names every platform by something the artist row actually has", () => {
        // The check my own coverage script could not make. It compared urlmap
        // to information_schema COLUMN names, but the code indexes the Drizzle
        // ROW — and the property can differ. `facebookID` is the column,
        // `facebookId` the property, so the lookup read undefined and an
        // artist's own numeric Facebook profile was never recognised as one we
        // already hold; it could still be filed as press about them.
        const onTheRow = new Set(Object.keys(artists));
        const unreadable = PROFILE_LINK_COLUMNS.filter(
            col => !onTheRow.has(artistRowProperty(col)));
        expect(unreadable).toEqual([]);
    });
});
