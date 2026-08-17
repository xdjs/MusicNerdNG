const UA = "MusicNerd/1.0 (https://musicnerd.xyz)";
const MIN_EXTRACT = 40; // ignore stub articles

export type VerifiedGrounding = { source: "wikipedia"; url: string; extract: string };

/**
 * Resolve premium encyclopedic grounding for an artist by VERIFIED ID:
 * Spotify ID → Wikidata (property P1902 = Spotify artist ID) → English Wikipedia extract.
 *
 * This is ID-based, so it is conflation-safe: it returns the correct article or
 * null — never a same-name namesake (a name search would). The extract is used
 * only as GROUNDING for original generation; it is never reproduced verbatim.
 *
 * Returns null (never throws) on any miss or network error.
 */
export async function resolveVerifiedGrounding(
  spotifyId: string | null | undefined
): Promise<VerifiedGrounding | null> {
  if (!spotifyId) return null;
  // Spotify artist IDs are base62 (letters + digits). Reject anything else before splicing
  // into the SPARQL string — defense-in-depth so a malformed/hostile value (e.g. one written
  // via UGC/MCP that slipped a quote through) can't break out of the literal and inject a
  // query against Wikidata's public endpoint. A rejected ID simply yields no grounding.
  if (!/^[A-Za-z0-9]+$/.test(spotifyId)) return null;
  try {
    const sparql =
      `SELECT ?item ?sitelink WHERE { ?item wdt:P1902 "${spotifyId}". ` +
      `OPTIONAL { ?sitelink schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . } } LIMIT 1`;
    const wdRes = await fetch(
      `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`,
      { headers: { "User-Agent": UA, Accept: "application/sparql-results+json" } }
    );
    if (!wdRes.ok) return null;
    const wd = await wdRes.json();
    const binding = wd?.results?.bindings?.[0];
    const sitelink: string | undefined = binding?.sitelink?.value;
    if (!sitelink) return null;

    const title = decodeURIComponent(sitelink.split("/wiki/")[1] ?? "");
    if (!title) return null;

    const wpRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { headers: { "User-Agent": UA } }
    );
    if (!wpRes.ok) return null;
    const wp = await wpRes.json();
    const extract: string = (wp?.extract ?? "").trim();
    if (extract.length < MIN_EXTRACT) return null;

    return { source: "wikipedia", url: sitelink, extract };
  } catch {
    return null;
  }
}
