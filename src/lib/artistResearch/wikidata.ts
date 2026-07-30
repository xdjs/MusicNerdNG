import {
  WIKIDATA_PLATFORM_DEFINITIONS,
  getResearchPlatformDefinition,
  normalizeResearchPlatformValue,
} from "./platformRegistry";
import type { ResearchFinding, ResearchPlatform } from "./types";

const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
const WIKIDATA_ENTITY_PREFIX = "http://www.wikidata.org/entity/";

export type WikidataLookupSourcePlatform = "spotify" | "deezer";

export const ARTIST_RESEARCH_USER_AGENT =
  "MusicNerdWeb/1.0 (https://musicnerd.xyz; contact@musicnerd.xyz)";

export type WikidataBindingValue = {
  type?: string;
  value?: string;
};

export type WikidataBinding = Record<string, WikidataBindingValue | undefined>;

export type WikidataEntityMatch = {
  entityId: string;
  values: Partial<Record<ResearchPlatform, string[]>>;
};

export type ParsedWikidataResults = {
  matches: Map<string, WikidataEntityMatch>;
  ambiguous: Map<string, string[]>;
};

export type WikidataFindingAmbiguity = {
  platform: ResearchPlatform;
  values: string[];
};

export type WikidataFindingsResult = {
  findings: ResearchFinding[];
  ambiguities: WikidataFindingAmbiguity[];
};

function isSafeWikidataLookupId(
  value: string,
  sourcePlatform?: WikidataLookupSourcePlatform,
): boolean {
  if (sourcePlatform === "spotify") return /^[A-Za-z0-9]+$/.test(value);
  if (sourcePlatform === "deezer") return /^\d+$/.test(value);
  return /^[A-Za-z0-9._:-]+$/.test(value);
}

function extractEntityId(value: string | undefined): string | null {
  if (!value) return null;
  const entityId = value.replace(WIKIDATA_ENTITY_PREFIX, "");
  return /^Q\d+$/.test(entityId) ? entityId : null;
}

export function filterSafeWikidataLookupIds(
  ids: readonly string[],
  sourcePlatform?: WikidataLookupSourcePlatform,
): string[] {
  return [
    ...new Set(
      ids
        .map((id) => id.trim())
        .filter((id) => isSafeWikidataLookupId(id, sourcePlatform)),
    ),
  ];
}

export function buildWikidataArtistQuery(
  sourcePlatform: WikidataLookupSourcePlatform,
  sourceIds: readonly string[],
  targetPlatforms?: readonly ResearchPlatform[],
): string {
  if (sourcePlatform !== "spotify" && sourcePlatform !== "deezer") {
    throw new Error(`Wikidata lookup is not supported for ${sourcePlatform}`);
  }
  const sourceDefinition = getResearchPlatformDefinition(sourcePlatform);
  if (!sourceDefinition.wikidataProperty) {
    throw new Error(`Wikidata lookup is not supported for ${sourcePlatform}`);
  }

  const safeIds = filterSafeWikidataLookupIds(sourceIds, sourcePlatform);
  if (safeIds.length === 0) {
    throw new Error("At least one valid source ID is required");
  }

  const values = safeIds.map((id) => `"${id}"`).join(" ");
  const targetPlatformSet = targetPlatforms
    ? new Set<ResearchPlatform>(targetPlatforms)
    : null;
  const targetDefinitions = targetPlatformSet
    ? WIKIDATA_PLATFORM_DEFINITIONS.filter((definition) =>
        targetPlatformSet.has(definition.key),
      )
    : WIKIDATA_PLATFORM_DEFINITIONS;
  const selectVariables = targetDefinitions.map(
    ({ wikidataVariable }) => `?${wikidataVariable}`,
  ).join(" ");
  const optionals = targetDefinitions.map(
    ({ wikidataProperty, wikidataVariable }) =>
      `  OPTIONAL { ?item wdt:${wikidataProperty} ?${wikidataVariable} }`,
  ).join("\n");

  return `
SELECT ?item ?sourceId ${selectVariables}
WHERE {
  VALUES ?sourceId { ${values} }
  ?item wdt:${sourceDefinition.wikidataProperty} ?sourceId .
${optionals}
}`.trim();
}

export function parseWikidataArtistBindings(
  bindings: readonly WikidataBinding[],
): ParsedWikidataResults {
  const grouped = new Map<
    string,
    {
      entities: Set<string>;
      values: Map<ResearchPlatform, Set<string>>;
    }
  >();

  for (const row of bindings) {
    const sourceId = row.sourceId?.value;
    const entityId = extractEntityId(row.item?.value);
    if (!sourceId || !entityId) continue;

    let entry = grouped.get(sourceId);
    if (!entry) {
      entry = { entities: new Set(), values: new Map() };
      grouped.set(sourceId, entry);
    }
    entry.entities.add(entityId);

    for (const definition of WIKIDATA_PLATFORM_DEFINITIONS) {
      const value = row[definition.wikidataVariable]?.value;
      if (!value) continue;
      let platformValues = entry.values.get(definition.key);
      if (!platformValues) {
        platformValues = new Set();
        entry.values.set(definition.key, platformValues);
      }
      platformValues.add(value);
    }
  }

  const matches = new Map<string, WikidataEntityMatch>();
  const ambiguous = new Map<string, string[]>();

  for (const [sourceId, entry] of grouped) {
    if (entry.entities.size !== 1) {
      ambiguous.set(sourceId, [...entry.entities]);
      continue;
    }

    const entityId = [...entry.entities][0];
    const values: Partial<Record<ResearchPlatform, string[]>> = {
      wikidata: [entityId],
    };
    for (const [platform, platformValues] of entry.values) {
      values[platform] = [...platformValues];
    }
    matches.set(sourceId, { entityId, values });
  }

  return { matches, ambiguous };
}

export async function lookupWikidataArtists(params: {
  sourcePlatform: WikidataLookupSourcePlatform;
  sourceIds: readonly string[];
  targetPlatforms?: readonly ResearchPlatform[];
  fetchImpl?: typeof fetch;
}): Promise<ParsedWikidataResults> {
  const {
    sourcePlatform,
    sourceIds,
    targetPlatforms,
    fetchImpl = fetch,
  } = params;
  const query = buildWikidataArtistQuery(
    sourcePlatform,
    sourceIds,
    targetPlatforms,
  );
  const response = await fetchImpl(WIKIDATA_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "User-Agent": ARTIST_RESEARCH_USER_AGENT,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `query=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(
      `Wikidata SPARQL error: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as {
    results?: { bindings?: WikidataBinding[] };
  };
  return parseWikidataArtistBindings(data.results?.bindings ?? []);
}

export function wikidataMatchToFindings(params: {
  match: WikidataEntityMatch;
  sourcePlatform?: ResearchPlatform;
}): WikidataFindingsResult {
  const { match, sourcePlatform } = params;
  const findings: ResearchFinding[] = [];
  const ambiguities: WikidataFindingAmbiguity[] = [];

  for (const [platform, values] of Object.entries(match.values) as [
    ResearchPlatform,
    string[],
  ][]) {
    if (platform === sourcePlatform || values.length === 0) continue;
    const normalizedValues = [
      ...new Set(
        values
          .map((value) => normalizeResearchPlatformValue(platform, value))
          .filter(Boolean),
      ),
    ];
    if (normalizedValues.length === 0) continue;
    if (normalizedValues.length > 1) {
      ambiguities.push({ platform, values: normalizedValues });
      continue;
    }
    const definition = getResearchPlatformDefinition(platform);
    const value = normalizedValues[0];
    findings.push({
      kind: definition.kind,
      platform,
      value,
      confidence: "high",
      source: "wikidata",
      reasoning: `Found on Wikidata entity ${match.entityId}`,
      evidence: [
        { type: "entity", value: match.entityId, label: "Wikidata entity" },
      ],
    });
  }

  return { findings, ambiguities };
}
