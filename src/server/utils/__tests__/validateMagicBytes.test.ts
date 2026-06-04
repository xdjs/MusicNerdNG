import { validateMagicBytes } from "../validateMagicBytes";

/** Helper to create a Buffer from byte values, padded to 12 bytes */
function buf(...bytes: number[]): Buffer {
    const arr = new Uint8Array(12);
    bytes.forEach((b, i) => { arr[i] = b; });
    return Buffer.from(arr);
}

describe("validateMagicBytes", () => {
    describe("PDF", () => {
        it("accepts valid PDF header", () => {
            expect(validateMagicBytes(buf(0x25, 0x50, 0x44, 0x46), "application/pdf")).toBe(true);
        });
        it("rejects wrong header claiming PDF", () => {
            expect(validateMagicBytes(buf(0x89, 0x50, 0x4E, 0x47), "application/pdf")).toBe(false);
        });
    });

    describe("PNG", () => {
        it("accepts valid PNG header", () => {
            expect(validateMagicBytes(buf(0x89, 0x50, 0x4E, 0x47), "image/png")).toBe(true);
        });
        it("rejects JPEG bytes claiming PNG", () => {
            expect(validateMagicBytes(buf(0xFF, 0xD8, 0xFF), "image/png")).toBe(false);
        });
    });

    describe("JPEG", () => {
        it("accepts valid JPEG header", () => {
            expect(validateMagicBytes(buf(0xFF, 0xD8, 0xFF), "image/jpeg")).toBe(true);
        });
        it("rejects PNG bytes claiming JPEG", () => {
            expect(validateMagicBytes(buf(0x89, 0x50, 0x4E, 0x47), "image/jpeg")).toBe(false);
        });
    });

    describe("DOC (OLE2)", () => {
        it("accepts valid DOC header", () => {
            expect(validateMagicBytes(buf(0xD0, 0xCF, 0x11, 0xE0), "application/msword")).toBe(true);
        });
        it("rejects wrong header claiming DOC", () => {
            expect(validateMagicBytes(buf(0x50, 0x4B, 0x03, 0x04), "application/msword")).toBe(false);
        });
    });

    describe("DOCX (ZIP/OOXML)", () => {
        const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        it("accepts valid DOCX header (PK ZIP)", () => {
            expect(validateMagicBytes(buf(0x50, 0x4B, 0x03, 0x04), docxMime)).toBe(true);
        });
        it("rejects OLE2 bytes claiming DOCX", () => {
            expect(validateMagicBytes(buf(0xD0, 0xCF, 0x11, 0xE0), docxMime)).toBe(false);
        });
    });

    describe("WebP (RIFF + WEBP subtype)", () => {
        it("accepts valid WebP header", () => {
            // RIFF + 4 size bytes + WEBP
            const header = buf(0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50);
            expect(validateMagicBytes(header, "image/webp")).toBe(true);
        });
        it("rejects WAV bytes claiming WebP", () => {
            const wavHeader = buf(0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45);
            expect(validateMagicBytes(wavHeader, "image/webp")).toBe(false);
        });
        it("rejects non-RIFF bytes claiming WebP", () => {
            expect(validateMagicBytes(buf(0x89, 0x50, 0x4E, 0x47), "image/webp")).toBe(false);
        });
    });

    describe("WAV (RIFF + WAVE subtype)", () => {
        it("accepts valid WAV header", () => {
            const header = buf(0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45);
            expect(validateMagicBytes(header, "audio/wav")).toBe(true);
        });
        it("rejects WebP bytes claiming WAV", () => {
            const webpHeader = buf(0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50);
            expect(validateMagicBytes(webpHeader, "audio/wav")).toBe(false);
        });
    });

    describe("MP3", () => {
        it("accepts ID3v2 tagged MP3", () => {
            expect(validateMagicBytes(buf(0x49, 0x44, 0x33), "audio/mpeg")).toBe(true);
        });
        it("accepts raw MP3 sync word 0xFF 0xFB", () => {
            expect(validateMagicBytes(buf(0xFF, 0xFB), "audio/mpeg")).toBe(true);
        });
        it("accepts raw MP3 sync word 0xFF 0xFA", () => {
            expect(validateMagicBytes(buf(0xFF, 0xFA), "audio/mpeg")).toBe(true);
        });
        it("rejects non-MP3 bytes claiming audio/mpeg", () => {
            expect(validateMagicBytes(buf(0x25, 0x50, 0x44, 0x46), "audio/mpeg")).toBe(false);
        });
    });

    describe("text-based formats (no magic bytes)", () => {
        it("passes text/plain regardless of content", () => {
            expect(validateMagicBytes(buf(0x00, 0x00, 0x00), "text/plain")).toBe(true);
        });
        it("passes application/json regardless of content", () => {
            expect(validateMagicBytes(buf(0xFF, 0xFE), "application/json")).toBe(true);
        });
        it("passes text/csv regardless of content", () => {
            expect(validateMagicBytes(buf(0x41, 0x42), "text/csv")).toBe(true);
        });
    });
});
