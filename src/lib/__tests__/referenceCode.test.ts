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

    it("produces effectively-unique codes across a large batch (high entropy)", () => {
        // The generator is RANDOM over a 32^4 ≈ 1.05M code space; it does not
        // guarantee strict uniqueness across independent calls. Asserting "all N
        // unique" was therefore flaky — 50 codes collide with ~0.12% probability
        // (birthday paradox), which reddened CI intermittently.
        //
        // Instead assert the property that actually holds: the uniqueness rate
        // stays very high over a large batch. Expected collisions in 2000 draws
        // ≈ 1.9, so the `>= N - 20` threshold has a flake probability far below
        // 1e-9 while still catching a genuinely low-entropy regression.
        const N = 2000;
        const codes = new Set<string>();
        for (let i = 0; i < N; i++) {
            codes.add(generateReferenceCode());
        }
        expect(codes.size).toBeGreaterThanOrEqual(N - 20);
    });
});
