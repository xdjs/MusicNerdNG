/**
 * Preserve the normalization rules used by the existing ID-mapping script.
 * Deliberately does not collapse punctuation or internal whitespace.
 */
export function normalizeArtistName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/\s+(feat\.?|ft\.?|featuring)\s+.*/i, "")
    .trim();
}

export function artistNamesMatch(a: string, b: string): boolean {
  return normalizeArtistName(a) === normalizeArtistName(b);
}
