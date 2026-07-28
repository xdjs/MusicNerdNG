// Extension → canonical MIME type, for files whose browser-reported `file.type`
// is empty or nonstandard. Browsers commonly report "" for .md (and occasionally
// generic values like application/octet-stream for known types), which a strict
// MIME allowlist would wrongly reject. Keep these in sync with the upload routes'
// ALLOWED_TYPES.
const EXT_TO_MIME: Record<string, string> = {
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/markdown",
    markdown: "text/markdown",
    csv: "text/csv",
    json: "application/json",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    mp3: "audio/mpeg",
    wav: "audio/wav",
};

/**
 * Resolve a file's effective MIME type against an allowlist.
 *
 * Prefers the browser-declared type when it is itself allowed (preserves existing
 * behavior — adds no new acceptance path for spoofed binaries, which are still
 * caught downstream by validateMagicBytes). Otherwise falls back to the file
 * extension. Returns null when neither the declared type nor the extension maps
 * to an allowed type, so the caller can reject with a clear "unsupported" error.
 *
 * @param fileName     the original upload filename (used for the extension fallback)
 * @param declaredType the browser-reported MIME type (may be "" / nonstandard)
 * @param allowed      the caller's allowlist of acceptable MIME types
 */
export function resolveUploadType(
    fileName: string,
    declaredType: string,
    allowed: readonly string[]
): string | null {
    const declared = (declaredType || "").trim().toLowerCase();
    if (declared && allowed.includes(declared)) return declared;

    const ext = fileName.includes(".")
        ? fileName.split(".").pop()!.toLowerCase()
        : "";
    const fromExt = ext ? EXT_TO_MIME[ext] : undefined;
    if (fromExt && allowed.includes(fromExt)) return fromExt;

    return null;
}
