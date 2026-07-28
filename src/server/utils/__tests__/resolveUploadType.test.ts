import { resolveUploadType } from "../resolveUploadType";

// Mirrors the vault upload route's ALLOWED_TYPES so tests exercise the real allowlist.
const ALLOWED = [
    "application/pdf",
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/json",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/png",
    "image/jpeg",
    "image/webp",
    "audio/mpeg",
    "audio/wav",
];

describe("resolveUploadType", () => {
    it("uses the declared type when it is allowed", () => {
        expect(resolveUploadType("notes.txt", "text/plain", ALLOWED)).toBe("text/plain");
        expect(resolveUploadType("doc.pdf", "application/pdf", ALLOWED)).toBe("application/pdf");
    });

    it("falls back to the extension when the browser reports an EMPTY type (the .md case)", () => {
        // Browsers frequently report "" for .md — a strict MIME allowlist would wrongly reject it.
        expect(resolveUploadType("readme.md", "", ALLOWED)).toBe("text/markdown");
        expect(resolveUploadType("data.csv", "", ALLOWED)).toBe("text/csv");
        expect(resolveUploadType("paper.pdf", "", ALLOWED)).toBe("application/pdf");
    });

    it("falls back to the extension when the declared type is a generic non-allowed value", () => {
        // Some browsers send application/octet-stream for known types.
        expect(resolveUploadType("paper.pdf", "application/octet-stream", ALLOWED)).toBe("application/pdf");
    });

    it("is case-insensitive on both extension and declared type", () => {
        expect(resolveUploadType("READExME.MD", "", ALLOWED)).toBe("text/markdown");
        expect(resolveUploadType("PHOTO.JPEG", "IMAGE/JPEG", ALLOWED)).toBe("image/jpeg");
    });

    it("maps .markdown and .jpg aliases", () => {
        expect(resolveUploadType("readme.markdown", "", ALLOWED)).toBe("text/markdown");
        expect(resolveUploadType("pic.jpg", "", ALLOWED)).toBe("image/jpeg");
    });

    it("returns null for a genuinely unsupported type (empty MIME, unknown ext)", () => {
        expect(resolveUploadType("malware.exe", "", ALLOWED)).toBeNull();
        expect(resolveUploadType("archive.zip", "application/zip", ALLOWED)).toBeNull();
        expect(resolveUploadType("noextension", "", ALLOWED)).toBeNull();
    });

    it("prefers an allowed declared type even when the extension differs", () => {
        // Declared type wins when allowed — preserves existing behavior, adds no new spoof path.
        expect(resolveUploadType("weird.name.pdf", "text/plain", ALLOWED)).toBe("text/plain");
    });
});
