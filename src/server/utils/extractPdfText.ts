import pdfParse from "pdf-parse/lib/pdf-parse.js";

const PDF_PARSE_TIMEOUT_MS = 10_000;

/**
 * Extract text from a PDF buffer. Returns null on failure or empty result so
 * the upload still succeeds (the file is stored regardless) — we just lose the
 * text context for bio/funFacts generation.
 *
 * Imports the lib entry directly: pdf-parse's index.js runs a debug block that
 * reads a bundled test PDF from disk and throws ENOENT in serverless.
 */
export async function extractPdfText(buffer: Buffer): Promise<string | null> {
  try {
    const result = await Promise.race([
      pdfParse(buffer),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("PDF parse timeout")), PDF_PARSE_TIMEOUT_MS)
      ),
    ]);
    const text = result.text?.trim();
    return text && text.length > 0 ? text : null;
  } catch (err) {
    console.error("[extractPdfText] Failed to parse PDF:", err);
    return null;
  }
}
