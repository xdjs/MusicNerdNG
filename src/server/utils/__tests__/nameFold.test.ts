// @ts-nocheck
import { foldName } from "../nameFold";

describe("foldName", () => {
    it.each([
        ["Beyoncé", "beyonce"],
        ["Sigur Rós", "sigurros"],
        ["Björk", "bjork"],
        ["Pete Rango", "peterango"],
    ])("folds %s to %s", (input, expected) => {
        expect(foldName(input)).toBe(expected);
    });

    it.each([
        ["𝐁𝐋𝐀𝐂𝐊𝐃𝐀𝐕𝐄 𝐌𝐊𝟐", "blackdavemk2"],   // the real title of x.com/BlackDave
        ["𝓅𝑒𝓉𝑒 𝓇𝒶𝓃𝑔𝑜", "peterango"],
    ])("decomposes styled unicode before lowercasing: %s", (input, expected) => {
        // The old order — lowercase, THEN normalize — folded the first of these
        // to "2". Mathematical-bold capitals have no lowercase form, so
        // toLowerCase left them, NFKD then produced ASCII CAPITALS, and the
        // [^a-z0-9] strip removed every letter. Black Dave MK2's own X profile
        // title did not match his name.
        expect(foldName(input)).toBe(expected);
    });

    it("is stable on names with nothing to fold", () => {
        expect(foldName("dupesdidit")).toBe("dupesdidit");
        expect(foldName("")).toBe("");
    });
});
