import { randomBytes } from "crypto";

// Uppercase alphanumeric chars, excluding ambiguous ones (I, O, 0, 1)
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateReferenceCode(): string {
    const bytes = randomBytes(4);
    // Rejection sampling to eliminate modulo bias
    const code = Array.from(bytes)
        .map(b => {
            // Rejection sampling to eliminate modulo bias. With the current
            // 32-char alphabet this branch never fires (256 % 32 === 0, so
            // limit === 256), but it keeps the generator unbiased if CHARS
            // ever changes to a length that doesn't divide 256 evenly.
            const limit = 256 - (256 % CHARS.length);
            if (b >= limit) return CHARS[randomBytes(1)[0] % CHARS.length]; // re-roll
            return CHARS[b % CHARS.length];
        })
        .join("");
    return `MN-${code}`;
}
