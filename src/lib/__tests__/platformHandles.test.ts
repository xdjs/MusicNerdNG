// @ts-nocheck
import { isReservedHandle } from "@/lib/platformHandles";

describe("isReservedHandle", () => {
    it("rejects the handle a post URL parses into", () => {
        // instagram.com/p/DUtSSjnCYcU is a POST, and the urlmap regex reads its
        // first path segment as the handle — so it arrives as { instagram, "p" }.
        // Anything writing that sets the artist's Instagram to "p". Discovery
        // surfaces post URLs constantly, so this was one readable page away.
        expect(isReservedHandle("instagram", "p")).toBe(true);
        expect(isReservedHandle("instagram", "reel")).toBe(true);
        expect(isReservedHandle("x", "i")).toBe(true);
        expect(isReservedHandle("x", "status")).toBe(true);
        expect(isReservedHandle("youtube", "watch")).toBe(true);
        expect(isReservedHandle("spotify", "track")).toBe(true);
    });

    it("lets a real handle through", () => {
        expect(isReservedHandle("instagram", "p3t3rango")).toBe(false);
        expect(isReservedHandle("x", "p3t3rango")).toBe(false);
        expect(isReservedHandle("soundcloud", "peterango")).toBe(false);
    });

    it("ignores case and a leading @", () => {
        expect(isReservedHandle("instagram", "@Reel")).toBe(true);
        expect(isReservedHandle("instagram", "@P3t3rango")).toBe(false);
    });

    it("treats a one-character handle as reserved on any platform", () => {
        // No artist's handle is one character on these services, and a
        // single-character id is far likelier to be a truncated path.
        expect(isReservedHandle("bandcamp", "a")).toBe(true);
        expect(isReservedHandle("unknownplatform", "")).toBe(true);
    });

    it("says nothing about platforms it has no list for", () => {
        expect(isReservedHandle("linktree", "peterango")).toBe(false);
    });
});
