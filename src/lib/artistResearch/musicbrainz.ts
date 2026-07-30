import {
  extractResearchPlatformFromUrl,
  getResearchPlatformDefinition,
} from "./platformRegistry";
import { artistNamesMatch } from "./normalization";
import type { ResearchFinding, ResearchPlatform } from "./types";
import { ARTIST_RESEARCH_USER_AGENT } from "./wikidata";

export type MusicBrainzRelation = {
  type?: string;
  url?: { resource?: string };
};

export type MusicBrainzResult = {
  deezerId?: string;
  otherUrls: { platform: ResearchPlatform; id: string }[];
  findings: ResearchFinding[];
  ambiguities: { platform: ResearchPlatform; values: string[] }[];
};

export type MusicBrainzSearchMatch = {
  mbid: string;
  name: string;
};

function findingFor(
  platform: ResearchPlatform,
  value: string,
  evidenceUrl: string,
): ResearchFinding {
  return {
    kind: getResearchPlatformDefinition(platform).kind,
    platform,
    value,
    confidence: "high",
    source: "musicbrainz",
    reasoning: "Found in MusicBrainz URL relationships",
    evidence: [{ type: "url", value: evidenceUrl }],
  };
}

export function parseMusicBrainzRelations(
  relations: readonly MusicBrainzRelation[],
): MusicBrainzResult {
  const result: MusicBrainzResult = {
    otherUrls: [],
    findings: [],
    ambiguities: [],
  };
  const findingCandidates = new Map<
    ResearchPlatform,
    Map<string, ResearchFinding>
  >();

  const addFindingCandidate = (finding: ResearchFinding) => {
    let platformCandidates = findingCandidates.get(finding.platform);
    if (!platformCandidates) {
      platformCandidates = new Map();
      findingCandidates.set(finding.platform, platformCandidates);
    }
    platformCandidates.set(finding.value, finding);
  };

  for (const relation of relations) {
    const url = relation.url?.resource;
    if (!url) continue;

    const extracted = extractResearchPlatformFromUrl(url);
    if (extracted) {
      if (extracted.platform === "deezer") {
        // Preserve the legacy resolver's last-Deezer-link-wins behavior.
        result.deezerId = extracted.value;
      } else {
        result.otherUrls.push({
          platform: extracted.platform,
          id: extracted.value,
        });
      }
      addFindingCandidate(
        findingFor(extracted.platform, extracted.value, url),
      );
      continue;
    }

    const relationType = relation.type?.toLowerCase() ?? "";
    if (
      relationType === "official homepage" ||
      relationType === "official site"
    ) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          const normalizedUrl = parsed.toString();
          addFindingCandidate(
            findingFor("official_website", normalizedUrl, normalizedUrl),
          );
        }
      } catch {
        // Ignore malformed relation URLs.
      }
    }
  }

  for (const [platform, candidates] of findingCandidates) {
    if (candidates.size === 1) {
      result.findings.push([...candidates.values()][0]);
    } else {
      result.ambiguities.push({
        platform,
        values: [...candidates.keys()],
      });
    }
  }
  return result;
}

export function escapeMusicBrainzLuceneValue(value: string): string {
  return value.replace(/([+\-!(){}[\]^"~*?:\\\/])/g, "\\$1");
}

export function selectUniqueMusicBrainzNameMatch(
  artists: readonly { id?: string; name?: string }[],
  expectedName: string,
): MusicBrainzSearchMatch | null {
  const matches = artists.filter(
    (artist) =>
      Boolean(artist.id && artist.name) &&
      artistNamesMatch(artist.name ?? "", expectedName),
  );
  if (matches.length !== 1) return null;

  return {
    mbid: matches[0].id as string,
    name: matches[0].name as string,
  };
}

export async function queryMusicBrainzByMbid(
  mbid: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MusicBrainzResult> {
  const response = await fetchImpl(
    `https://musicbrainz.org/ws/2/artist/${encodeURIComponent(mbid)}?inc=url-rels&fmt=json`,
    {
      headers: { "User-Agent": ARTIST_RESEARCH_USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error(`MusicBrainz ${response.status}`);

  const data = (await response.json()) as {
    relations?: MusicBrainzRelation[];
  };
  const result = parseMusicBrainzRelations(data.relations ?? []);
  result.findings = result.findings.filter(
    (finding) => finding.platform !== "musicbrainz",
  );
  result.findings.unshift({
    kind: "platform_id",
    platform: "musicbrainz",
    value: mbid,
    confidence: "high",
    source: "musicbrainz",
    reasoning: "Resolved MusicBrainz artist record",
    evidence: [{ type: "identifier", value: mbid, label: "MusicBrainz ID" }],
  });
  return result;
}

export async function queryMusicBrainzByName(
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MusicBrainzSearchMatch | null> {
  const escapedName = escapeMusicBrainzLuceneValue(name);
  const response = await fetchImpl(
    `https://musicbrainz.org/ws/2/artist/?query=artist:"${encodeURIComponent(escapedName)}"&fmt=json&limit=10`,
    {
      headers: { "User-Agent": ARTIST_RESEARCH_USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    throw new Error(`MusicBrainz search ${response.status}`);
  }

  const data = (await response.json()) as {
    artists?: { id?: string; name?: string }[];
  };
  return selectUniqueMusicBrainzNameMatch(data.artists ?? [], name);
}
