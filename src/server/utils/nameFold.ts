/**
 * One artist name, comparably.
 *
 * Lowercase, NFKD-decompose, drop combining diacritics, drop everything that is
 * not alphanumeric — so "Sigur Rós" and "sigur ros" are the same name, and
 * "𝐁𝐋𝐀𝐂𝐊𝐃𝐀𝐕𝐄 𝐌𝐊𝟐" (real, from an X profile title) folds to "blackdavemk2".
 *
 * Shared rather than copied. This existed twice — `normalizeForCompare` in
 * profileDiscovery and `fold` in isrcMatch — which meant a fix to one (a
 * Unicode edge case, say) would silently leave the other behind, and the two
 * are used to decide the SAME question about the same artist.
 *
 * The diacritic range is written as escapes on purpose. Spelling it with
 * literal combining characters is unreadable, survives copy-paste badly, and is
 * exactly how this codebase has broken Unicode matching before.
 */
export function foldName(s: string): string {
    // NFKD FIRST, THEN LOWERCASE. The other order looks identical and is not:
    // mathematical-bold capitals have no lowercase form, so `toLowerCase()`
    // leaves them alone, NFKD then yields ASCII CAPITALS, and `[^a-z0-9]`
    // strips every one of them.
    //
    // "𝐁𝐋𝐀𝐂𝐊𝐃𝐀𝐕𝐄 𝐌𝐊𝟐" — the actual title of x.com/BlackDave — folded to "2".
    // Black Dave MK2's own X profile did not match his name. This was the
    // pre-existing order in `normalizeForCompare`, which now shares this code.
    return s
        .normalize("NFKD")
        .toLowerCase()
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "");
}
