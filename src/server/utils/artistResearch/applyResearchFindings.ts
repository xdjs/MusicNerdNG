import { eq } from "drizzle-orm";

import {
  getResearchPlatformDefinition,
  isResearchPlatform,
  normalizeResearchPlatformValue,
} from "@/lib/artistResearch/platformRegistry";
import {
  ID_MAPPING_PLATFORM_VALUES,
  RESEARCH_CONFIDENCE_VALUES,
  RESEARCH_SOURCE_VALUES,
  type ResearchConfidence,
  type ResearchFinding,
  type ResearchPlatform,
  type ResearchSource,
} from "@/lib/artistResearch/types";
import { db } from "@/server/db/drizzle";
import { artists } from "@/server/db/schema";
import {
  writeArtistLinkValue,
  type ArtistLinkExecutor,
  type ArtistLinkWriteResult,
} from "@/server/utils/artistLinkService";
import {
  MappingConflictError,
  resolveArtistMappingWithExecutor,
  type MappingExecutor,
  type ResolveArtistMappingResult,
} from "@/server/utils/idMappingService";

type ResearchDatabase = Pick<typeof db, "transaction">;

export type ResearchFindingConflict =
  | {
      reason: "existing_artist_value";
      field: string;
      existingValue?: string;
    }
  | {
      reason: "platform_id_owned_by_another_artist";
      conflictingArtistId?: string;
    }
  | { reason: "mapping_conflict" }
  | {
      reason: "conflicting_findings";
      candidateValues: string[];
      candidateFindings: ResearchFinding[];
    };

export type ApplyResearchFindingResult = {
  finding: ResearchFinding;
  status: "applied" | "unchanged" | "skipped" | "conflict" | "error";
  mutated: boolean;
  winningValue?: string;
  mapping?: ResolveArtistMappingResult;
  artistField?: {
    column: string;
    status: ArtistLinkWriteResult["status"];
    previousValue: string | null;
  };
  conflict?: ResearchFindingConflict;
  skipReason?: "no_storage_target";
  error?: string;
};

export type ApplyResearchFindingsResult = {
  results: ApplyResearchFindingResult[];
  appliedCount: number;
  conflictCount: number;
  errorCount: number;
};

class ExpectedResearchConflict extends Error {
  constructor(public readonly details: ResearchFindingConflict) {
    super(details.reason);
    this.name = "ExpectedResearchConflict";
  }
}

function isUniqueViolation(error: unknown): boolean {
  for (const candidate of [
    error,
    error && typeof error === "object" && "cause" in error
      ? (error as { cause: unknown }).cause
      : null,
  ]) {
    if (
      candidate &&
      typeof candidate === "object" &&
      "code" in candidate &&
      (candidate as { code?: unknown }).code === "23505"
    ) {
      return true;
    }
  }
  return false;
}

const UNIQUE_ARTIST_ID_COLUMNS = {
  spotify: artists.spotify,
  deezer: artists.deezer,
} as const;
const RESEARCH_MAPPING_STORAGE_PLATFORMS = new Set<string>(
  ID_MAPPING_PLATFORM_VALUES,
);
const RESEARCH_CONFIDENCE_PRIORITY: Record<ResearchConfidence, number> = {
  manual: 4,
  high: 3,
  medium: 2,
  low: 1,
};
const RESEARCH_SOURCE_PRIORITY: Record<ResearchSource, number> = {
  manual: 5,
  wikidata: 4,
  musicbrainz: 3,
  web_search: 2,
  name_search: 1,
};

function mergeEquivalentFindings(
  left: ResearchFinding,
  right: ResearchFinding,
): ResearchFinding {
  const candidates = [left, right].sort((a, b) => {
    const confidenceDifference =
      RESEARCH_CONFIDENCE_PRIORITY[b.confidence] -
      RESEARCH_CONFIDENCE_PRIORITY[a.confidence];
    if (confidenceDifference !== 0) return confidenceDifference;

    const sourceDifference =
      RESEARCH_SOURCE_PRIORITY[b.source] - RESEARCH_SOURCE_PRIORITY[a.source];
    if (sourceDifference !== 0) return sourceDifference;

    return (a.reasoning ?? "").localeCompare(b.reasoning ?? "");
  });
  const winner = candidates[0];
  const evidenceByKey = new Map(
    [left, right]
      .flatMap((finding) => finding.evidence ?? [])
      .map((evidence) => [
        `${evidence.type}\u0000${evidence.value}\u0000${evidence.label ?? ""}`,
        evidence,
      ]),
  );
  const reasoning = [
    ...new Set(
      [left.reasoning, right.reasoning].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  ].sort();

  return {
    ...winner,
    reasoning: reasoning.length > 0 ? reasoning.join(" | ") : undefined,
    evidence:
      evidenceByKey.size > 0
        ? [...evidenceByKey.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, evidence]) => evidence)
        : undefined,
  };
}

type NormalizedResearchWorkItem =
  | { type: "finding"; finding: ResearchFinding }
  | {
      type: "conflict";
      finding: ResearchFinding;
      conflict: Extract<
        ResearchFindingConflict,
        { reason: "conflicting_findings" }
      >;
    };

function validateAndNormalizeFindings(
  findings: readonly ResearchFinding[],
): NormalizedResearchWorkItem[] {
  const confidenceValues = new Set<string>(RESEARCH_CONFIDENCE_VALUES);
  const sourceValues = new Set<string>(RESEARCH_SOURCE_VALUES);
  const byPlatform = new Map<
    ResearchPlatform,
    Map<string, ResearchFinding>
  >();
  const withoutStorageByPlatformValue = new Map<string, ResearchFinding>();

  for (const finding of findings) {
    if (!isResearchPlatform(finding.platform)) {
      throw new Error(`Invalid research platform: ${finding.platform}`);
    }
    const definition = getResearchPlatformDefinition(finding.platform);
    if (definition.kind !== finding.kind) {
      throw new Error(
        `Invalid finding kind for ${finding.platform}: expected ${definition.kind}`,
      );
    }
    if (!confidenceValues.has(finding.confidence)) {
      throw new Error(`Invalid confidence level: ${finding.confidence}`);
    }
    if (!sourceValues.has(finding.source)) {
      throw new Error(`Invalid research source: ${finding.source}`);
    }

    const value = normalizeResearchPlatformValue(
      finding.platform,
      finding.value,
    );
    if (!value) {
      throw new Error(`Invalid or empty value for ${finding.platform}`);
    }

    const normalizedFinding = { ...finding, value };
    if (definition.kind !== "platform_id" && !definition.artistColumn) {
      const key = `${finding.platform}\u0000${value}`;
      const equivalent = withoutStorageByPlatformValue.get(key);
      withoutStorageByPlatformValue.set(
        key,
        equivalent
          ? mergeEquivalentFindings(equivalent, normalizedFinding)
          : normalizedFinding,
      );
      continue;
    }

    const findingsByValue = byPlatform.get(finding.platform) ?? new Map();
    const existing = findingsByValue.get(value);
    if (existing) {
      findingsByValue.set(
        value,
        mergeEquivalentFindings(existing, normalizedFinding),
      );
    } else {
      findingsByValue.set(value, normalizedFinding);
    }
    byPlatform.set(finding.platform, findingsByValue);
  }

  return [
    ...[...byPlatform.values()].map((findingsByValue) => {
      const candidateFindings = [...findingsByValue.values()].sort((a, b) =>
        a.value.localeCompare(b.value),
      );
      const finding = candidateFindings[0];

      if (candidateFindings.length === 1) {
        return { type: "finding" as const, finding };
      }

      return {
        type: "conflict" as const,
        // `finding` remains populated for the existing per-result contract,
        // but no candidate is selected as a winner or sent to storage.
        finding,
        conflict: {
          reason: "conflicting_findings" as const,
          candidateValues: candidateFindings.map((candidate) => candidate.value),
          candidateFindings,
        },
      };
    }),
    ...[...withoutStorageByPlatformValue.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, finding]) => ({ type: "finding" as const, finding })),
  ];
}

async function findUniqueArtistIdOwner(
  database: MappingExecutor,
  artistId: string,
  platform: ResearchPlatform,
  platformId: string,
): Promise<string | null> {
  if (platform !== "spotify" && platform !== "deezer") return null;
  const column = UNIQUE_ARTIST_ID_COLUMNS[platform];
  const owner = await database.query.artists.findFirst({
    where: eq(column, platformId),
    columns: { id: true },
  });
  return owner && owner.id !== artistId ? owner.id : null;
}

async function applySingleResearchFinding(
  artistId: string,
  finding: ResearchFinding,
  apiKeyHash: string | undefined,
  database: ResearchDatabase,
): Promise<ApplyResearchFindingResult> {
  const definition = getResearchPlatformDefinition(finding.platform);
  const storesMapping = finding.kind === "platform_id";
  if (!storesMapping && !definition.artistColumn) {
    // Official websites are part of the discovery contract, but the existing
    // globally-unique ID mapping table is not valid storage for shared or
    // historical websites. A research-run findings store will own them in the
    // job/status phase.
    return {
      finding,
      status: "skipped",
      mutated: false,
      winningValue: finding.value,
      skipReason: "no_storage_target",
    };
  }

  try {
    return await database.transaction(async (transaction) => {
      const executor = transaction as MappingExecutor & ArtistLinkExecutor;
      const mapping = storesMapping
        ? await resolveArtistMappingWithExecutor(
            executor,
            {
              artistId,
              platform: finding.platform,
              platformId: finding.value,
              confidence: finding.confidence,
              source: finding.source,
              reasoning: finding.reasoning,
              apiKeyHash,
            },
            { validPlatforms: RESEARCH_MAPPING_STORAGE_PLATFORMS },
          )
        : undefined;
      const winningValue = mapping?.skipped
        ? mapping.previousMapping?.platformId ?? finding.value
        : finding.value;

      let artistField:
        | ApplyResearchFindingResult["artistField"]
        | undefined;
      if (definition.artistColumn) {
        const artistColumnOwner = await findUniqueArtistIdOwner(
          executor,
          artistId,
          finding.platform,
          winningValue,
        );
        if (artistColumnOwner) {
          throw new ExpectedResearchConflict({
            reason: "platform_id_owned_by_another_artist",
            conflictingArtistId: artistColumnOwner,
          });
        }

        const previousConfidence = mapping?.previousMapping?.confidence;
        const canReplacePreviousMirror =
          Boolean(mapping?.updated && previousConfidence) &&
          RESEARCH_CONFIDENCE_PRIORITY[finding.confidence] >
            (RESEARCH_CONFIDENCE_PRIORITY[
              previousConfidence as ResearchConfidence
            ] ?? 0);
        const fieldResult = await writeArtistLinkValue({
          database: executor,
          artistId,
          siteName: definition.artistColumn,
          value: winningValue,
          mode: "fill_empty",
          bioMode: "preserve",
          replaceIfValue: canReplacePreviousMirror
            ? mapping?.previousMapping?.platformId
            : undefined,
        });
        if (fieldResult.status === "conflict") {
          throw new ExpectedResearchConflict({
            reason: "existing_artist_value",
            field: definition.artistColumn,
            existingValue: fieldResult.oldValue ?? undefined,
          });
        }
        artistField = {
          column: definition.artistColumn,
          status: fieldResult.status,
          previousValue: fieldResult.oldValue,
        };
      }

      const mappingMutated = Boolean(mapping?.created || mapping?.updated);
      const artistFieldMutated = artistField?.status === "written";
      const mutated = mappingMutated || artistFieldMutated;
      const status: ApplyResearchFindingResult["status"] = mutated
        ? "applied"
        : mapping?.skipped
          ? "skipped"
          : "unchanged";

      return {
        finding,
        status,
        mutated,
        winningValue,
        mapping,
        artistField,
      };
    });
  } catch (error) {
    if (error instanceof ExpectedResearchConflict) {
      return {
        finding,
        status: "conflict",
        mutated: false,
        conflict: error.details,
      };
    }
    if (error instanceof MappingConflictError) {
      return {
        finding,
        status: "conflict",
        mutated: false,
        conflict: { reason: "mapping_conflict" },
      };
    }
    if (isUniqueViolation(error)) {
      return {
        finding,
        status: "conflict",
        mutated: false,
        conflict: { reason: "platform_id_owned_by_another_artist" },
      };
    }
    return {
      finding,
      status: "error",
      mutated: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Applies each finding in its own transaction. A conflict for one platform
 * cannot roll back successful findings for other platforms, while each
 * mapping + first-class artist-column mirror remains atomic.
 */
export async function applyResearchFindings(
  params: {
    artistId: string;
    findings: readonly ResearchFinding[];
    apiKeyHash?: string;
  },
  database: ResearchDatabase = db,
): Promise<ApplyResearchFindingsResult> {
  const workItems = validateAndNormalizeFindings(params.findings);
  const results: ApplyResearchFindingResult[] = [];

  for (const workItem of workItems) {
    if (workItem.type === "conflict") {
      results.push({
        finding: workItem.finding,
        status: "conflict",
        mutated: false,
        conflict: workItem.conflict,
      });
      continue;
    }

    results.push(
      await applySingleResearchFinding(
        params.artistId,
        workItem.finding,
        params.apiKeyHash,
        database,
      ),
    );
  }

  return {
    results,
    appliedCount: results.filter((result) => result.status === "applied").length,
    conflictCount: results.filter((result) => result.status === "conflict")
      .length,
    errorCount: results.filter((result) => result.status === "error").length,
  };
}
