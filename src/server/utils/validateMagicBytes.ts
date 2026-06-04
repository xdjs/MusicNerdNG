// Text-based formats with no reliable magic bytes — skip validation for these
const KNOWN_TEXT_TYPES = new Set(["text/plain", "text/markdown", "text/csv", "application/json"]);

/**
 * Validate that a file's binary header matches its declared MIME type.
 * Returns true if valid (or if no signature check exists for this type).
 * Returns false if the header contradicts the declared type.
 */
export function validateMagicBytes(buffer: Buffer, mimeType: string): boolean {
    const headerBytes = Array.from(new Uint8Array(buffer.slice(0, 12)));

    // Simple prefix signatures
    const magicSignatures: Record<string, number[]> = {
        "application/pdf": [0x25, 0x50, 0x44, 0x46],                                          // %PDF
        "image/png": [0x89, 0x50, 0x4E, 0x47],                                                // .PNG
        "image/jpeg": [0xFF, 0xD8, 0xFF],                                                     // JFIF
        "application/msword": [0xD0, 0xCF, 0x11, 0xE0],                                       // OLE2 (.doc)
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [0x50, 0x4B, 0x03, 0x04], // ZIP/OOXML (.docx)
    };

    const expected = magicSignatures[mimeType];
    if (expected) {
        return expected.every((b, i) => headerBytes[i] === b);
    }

    // RIFF-based formats: check bytes 0-3 for RIFF, bytes 8-11 for subtype
    const riffSubtypes: Record<string, number[]> = {
        "image/webp": [0x57, 0x45, 0x42, 0x50],  // WEBP
        "audio/wav":  [0x57, 0x41, 0x56, 0x45],   // WAVE
    };

    const riffSubtype = riffSubtypes[mimeType];
    if (riffSubtype) {
        const isRiff = [0x52, 0x49, 0x46, 0x46].every((b, i) => headerBytes[i] === b);
        const subtypeBytes = headerBytes.slice(8, 12);
        return isRiff && riffSubtype.every((b, i) => subtypeBytes[i] === b);
    }

    // MP3: ID3v2 tag or raw sync word
    if (mimeType === "audio/mpeg") {
        const mp3Signatures = [[0x49, 0x44, 0x33], [0xFF, 0xFB], [0xFF, 0xFA], [0xFF, 0xF3], [0xFF, 0xF2]];
        return mp3Signatures.some(sig => sig.every((b, i) => headerBytes[i] === b));
    }

    if (!KNOWN_TEXT_TYPES.has(mimeType)) {
        // WARNING: If a new binary MIME type is added to ALLOWED_TYPES, add its
        // signature here too — otherwise magic byte validation is silently skipped.
        // Sanitize and truncate to prevent log injection from user-supplied MIME types
        const sanitized = mimeType.replace(/[^\x20-\x7E]/g, "").slice(0, 100);
        console.warn(`[validateMagicBytes] No signature check for "${sanitized}", passing through`);
    }
    return true;
}
