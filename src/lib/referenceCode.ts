import { randomBytes } from "crypto";

// Uppercase alphanumeric chars, excluding ambiguous ones (I, O, 0, 1)
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateReferenceCode(): string {
    const bytes = randomBytes(4);
    // Rejection sampling to eliminate modulo bias
    const code = Array.from(bytes)
        .map(b => {
            const limit = 256 - (256 % CHARS.length); // 256 - (256 % 28) = 252
            if (b >= limit) return CHARS[randomBytes(1)[0] % CHARS.length]; // re-roll
            return CHARS[b % CHARS.length];
        })
        .join("");
    return `MN-${code}`;
}
