import { deezerProvider } from './deezerProvider';
import { spotifyProvider } from './spotifyProvider';
import type { MusicPlatform, MusicPlatformArtist } from './types';

export type ReciprocalArtistIdentity = {
    platform: MusicPlatform;
    platformId: string;
    source: 'wikidata';
    wikidataId: string;
};

const WIKIDATA_ENDPOINT = 'https://query.wikidata.org/sparql';
const WIKIDATA_TIMEOUT_MS = 4000;
const PROVIDER_VERIFICATION_TIMEOUT_MS = 5000;
const USER_AGENT = 'MusicNerdWeb/1.0 (https://musicnerd.xyz; contact@musicnerd.xyz)';

const WIKIDATA_PLATFORM_PROPERTY: Record<MusicPlatform, string> = {
    spotify: 'P1902',
    deezer: 'P2722',
};

type WikidataBinding = {
    item?: { value?: string };
    targetId?: { value?: string };
};

function normalizeArtistName(name: string): string {
    return name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^the\s+/, '')
        .replace(/\s+(?:feat|ft|featuring)\s+.*/, '')
        .trim();
}

function isValidPlatformId(platform: MusicPlatform, platformId: string): boolean {
    return platform === 'deezer'
        ? /^\d+$/.test(platformId)
        : /^[A-Za-z0-9]+$/.test(platformId);
}

async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    label: string,
): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
            () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
            timeoutMs,
        );
    });

    try {
        return await Promise.race([promise, timeout]);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

async function findWikidataCounterpart(
    sourcePlatform: MusicPlatform,
    sourcePlatformId: string,
    targetPlatform: MusicPlatform,
): Promise<{ platformId: string; wikidataId: string } | null> {
    if (!isValidPlatformId(sourcePlatform, sourcePlatformId)) return null;

    const sourceProperty = WIKIDATA_PLATFORM_PROPERTY[sourcePlatform];
    const targetProperty = WIKIDATA_PLATFORM_PROPERTY[targetPlatform];
    const sparql = `
SELECT ?item ?targetId WHERE {
  ?item wdt:${sourceProperty} "${sourcePlatformId}" .
  ?item wdt:${targetProperty} ?targetId .
  FILTER NOT EXISTS {
    ?otherSource wdt:${sourceProperty} "${sourcePlatformId}" .
    FILTER (?otherSource != ?item)
  }
  FILTER NOT EXISTS {
    ?otherTarget wdt:${targetProperty} ?targetId .
    FILTER (?otherTarget != ?item)
  }
}
LIMIT 10`;
    const response = await fetch(WIKIDATA_ENDPOINT, {
        method: 'POST',
        headers: {
            Accept: 'application/sparql-results+json',
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
        },
        body: `query=${encodeURIComponent(sparql)}`,
        signal: AbortSignal.timeout(WIKIDATA_TIMEOUT_MS),
    });

    if (!response.ok) {
        throw new Error(`Wikidata SPARQL returned ${response.status}`);
    }

    const data = await response.json() as {
        results?: { bindings?: WikidataBinding[] };
    };
    const entityIds = new Set<string>();
    const targetIds = new Set<string>();

    for (const binding of data.results?.bindings ?? []) {
        const entityId = binding.item?.value?.split('/').pop()?.trim();
        const targetId = binding.targetId?.value?.trim();
        if (
            !entityId
            || !/^Q\d+$/.test(entityId)
            || !targetId
            || !isValidPlatformId(targetPlatform, targetId)
        ) {
            continue;
        }
        entityIds.add(entityId);
        targetIds.add(targetId);
    }

    if (entityIds.size !== 1 || targetIds.size !== 1) return null;

    return {
        platformId: targetIds.values().next().value!,
        wikidataId: entityIds.values().next().value!,
    };
}

export async function findReciprocalArtistIdentity(
    artist: Pick<MusicPlatformArtist, 'platform' | 'platformId' | 'name'>,
): Promise<ReciprocalArtistIdentity | null> {
    const normalizedName = normalizeArtistName(artist.name);
    if (!normalizedName) return null;

    const targetPlatform: MusicPlatform = artist.platform === 'deezer' ? 'spotify' : 'deezer';
    const targetProvider = targetPlatform === 'spotify' ? spotifyProvider : deezerProvider;

    try {
        const counterpart = await findWikidataCounterpart(
            artist.platform,
            artist.platformId,
            targetPlatform,
        );
        if (!counterpart) return null;

        const verifiedArtist = await withTimeout(
            targetProvider.getArtist(counterpart.platformId),
            PROVIDER_VERIFICATION_TIMEOUT_MS,
            `${targetPlatform} artist verification`,
        );
        const verifiedPlatformId = verifiedArtist?.platformId?.trim();
        if (
            !verifiedArtist
            || !verifiedPlatformId
            || !isValidPlatformId(targetPlatform, verifiedPlatformId)
            || normalizeArtistName(verifiedArtist.name) !== normalizedName
        ) {
            return null;
        }

        return {
            platform: targetPlatform,
            platformId: verifiedPlatformId,
            source: 'wikidata',
            wikidataId: counterpart.wikidataId,
        };
    } catch (error) {
        console.error(
            `[CrossPlatformArtistResolver] Failed to resolve ${artist.platform}:${artist.platformId}:`,
            error,
        );
        return null;
    }
}
