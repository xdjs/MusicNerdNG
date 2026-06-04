import { generateReferenceCode } from "../referenceCode";

describe("generateReferenceCode", () => {
    it("returns a code in MN-XXXX format", () => {
        const code = generateReferenceCode();
        expect(code).toMatch(/^MN-[A-Z2-9]{4}$/);
    });

    it("excludes ambiguous characters (I, O, 0, 1)", () => {
        // Generate many codes and check none contain ambiguous chars
        for (let i = 0; i < 100; i++) {
            const code = generateReferenceCode();
            expect(code).not.toMatch(/[IO01]/);
        }
    });

    it("generates unique codes", () => {
        const codes = new Set<string>();
        for (let i = 0; i < 50; i++) {
            codes.add(generateReferenceCode());
        }
        // With 28^4 = ~600K possibilities, 50 codes should all be unique
        expect(codes.size).toBe(50);
    });
});
