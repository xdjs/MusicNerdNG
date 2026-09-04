import { deezerProvider } from './deezerProvider';
import { spotifyProvider } from './spotifyProvider';
import { findMusicBrainzCounterpart } from '@/server/utils/musicBrainzLinks';
import type { MusicPlatform, MusicPlatformArtist } from './types';

type ReciprocalArtistIdentityBase = {
    platform: MusicPlatform;
    platformId: string;
};

export type ReciprocalArtistIdentity = ReciprocalArtistIdentityBase & (
    | { source: 'wikidata'; wikidataId: string }
    | { source: 'musicbrainz'; musicbrainzId: string }
);

type Counterpart =
    | { platformId: string; source: 'wikidata'; wikidataId: string }
    | { platformId: string; source: 'musicbrainz'; musicbrainzId: string };

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
    otherTarget?: { value?: string };
};

type WikidataLookupResult =
    | { status: 'miss' }
    | { status: 'ambiguous' }
    | { status: 'match'; platformId: string; wikidataId: string };

function wikidataEntityId(value: string): string | null {
    return /^https?:\/\/www\.wikidata\.org\/entity\/(Q\d+)$/.exec(value)?.[1] ?? null;
}

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
): Promise<WikidataLookupResult> {
    if (!isValidPlatformId(sourcePlatform, sourcePlatformId)) return { status: 'miss' };

    const sourceProperty = WIKIDATA_PLATFORM_PROPERTY[sourcePlatform];
    const targetProperty = WIKIDATA_PLATFORM_PROPERTY[targetPlatform];
    const sparql = `
SELECT ?item ?targetId ?otherTarget WHERE {
  ?item wdt:${sourceProperty} "${sourcePlatformId}" .
  OPTIONAL {
    ?item wdt:${targetProperty} ?targetId .
    OPTIONAL {
      ?otherTarget wdt:${targetProperty} ?targetId .
      FILTER (?otherTarget != ?item)
    }
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
    const bindings = data?.results?.bindings;
    if (!Array.isArray(bindings)) {
        throw new Error('Wikidata SPARQL returned a malformed response');
    }
    if (bindings.length === 0) return { status: 'miss' };

    const entityIds = new Set<string>();
    const targetIds = new Set<string>();
    let targetOwnedElsewhere = false;
    let hasUnboundTarget = false;

    for (const binding of bindings) {
        const itemValue = binding?.item?.value;
        if (typeof itemValue !== 'string') {
            throw new Error('Wikidata SPARQL returned a malformed binding');
        }

        const entityId = wikidataEntityId(itemValue);
        if (!entityId) {
            throw new Error('Wikidata SPARQL returned a malformed binding');
        }
        entityIds.add(entityId);

        if (binding.targetId === undefined) {
            if (binding.otherTarget !== undefined) {
                throw new Error('Wikidata SPARQL returned a malformed binding');
            }
            hasUnboundTarget = true;
            continue;
        }

        const targetValue = binding.targetId?.value;
        if (typeof targetValue !== 'string') {
            throw new Error('Wikidata SPARQL returned a malformed binding');
        }
        const targetId = targetValue.trim();
        if (!targetId || !isValidPlatformId(targetPlatform, targetId)) {
            throw new Error('Wikidata SPARQL returned a malformed binding');
        }
        targetIds.add(targetId);

        if (binding.otherTarget !== undefined) {
            const otherTargetValue = binding.otherTarget?.value;
            if (
                typeof otherTargetValue !== 'string'
                || !wikidataEntityId(otherTargetValue)
            ) {
                throw new Error('Wikidata SPARQL returned a malformed binding');
            }
            targetOwnedElsewhere = true;
        }
    }

    if (hasUnboundTarget && targetIds.size > 0) {
        throw new Error('Wikidata SPARQL returned inconsistent bindings');
    }
    if (entityIds.size !== 1 || targetIds.size > 1 || targetOwnedElsewhere) {
        return { status: 'ambiguous' };
    }
    if (targetIds.size === 0) return { status: 'miss' };

    return {
        status: 'match',
        platformId: targetIds.values().next().value!,
        wikidataId: entityIds.values().next().value!,
    };
}

export async function findReciprocalArtistIdentity(
    artist: Pick<MusicPlatformArtist, 'platform' | 'platformId' | 'name'>,
): Promise<ReciprocalArtistIdentity | null> {
    if (!isValidPlatformId(artist.platform, artist.platformId)) return null;
    const normalizedName = normalizeArtistName(artist.name);
    if (!normalizedName) return null;

    const targetPlatform: MusicPlatform = artist.platform === 'deezer' ? 'spotify' : 'deezer';
    const targetProvider = targetPlatform === 'spotify' ? spotifyProvider : deezerProvider;
    let counterpart: Counterpart | null;

    try {
        const wikidataResult = await findWikidataCounterpart(
            artist.platform,
            artist.platformId,
            targetPlatform,
        );
        if (wikidataResult.status === 'ambiguous') return null;
        counterpart = wikidataResult.status === 'match'
            ? {
                platformId: wikidataResult.platformId,
                wikidataId: wikidataResult.wikidataId,
                source: 'wikidata',
            }
            : null;
    } catch (error) {
        // Do not redirect traffic to MusicBrainz during a Wikidata outage. The
        // fallback is for a definitive coverage miss, not a transport failure.
        console.error(
            `[CrossPlatformArtistResolver] Wikidata lookup failed for ${artist.platform}:${artist.platformId}:`,
            error,
        );
        return null;
    }

    if (!counterpart) {
        try {
            const musicBrainzCounterpart = await findMusicBrainzCounterpart(
                artist.platform,
                artist.platformId,
                targetPlatform,
            );
            counterpart = musicBrainzCounterpart && {
                ...musicBrainzCounterpart,
                source: 'musicbrainz',
            };
        } catch (error) {
            console.error(
                `[CrossPlatformArtistResolver] MusicBrainz lookup failed for ${artist.platform}:${artist.platformId}:`,
                error,
            );
            return null;
        }
    }

    if (!counterpart) return null;

    try {
        const verifiedArtist = await withTimeout(
            targetProvider.getArtistIdentity(counterpart.platformId),
            PROVIDER_VERIFICATION_TIMEOUT_MS,
            `${targetPlatform} artist verification`,
        );
        const verifiedPlatformId = verifiedArtist?.platformId?.trim();
        if (
            !verifiedArtist
            || !verifiedPlatformId
            || !isValidPlatformId(targetPlatform, verifiedPlatformId)
            // Ownership was proved for counterpart.platformId exactly. A
            // provider redirect/canonicalization may point at a different ID
            // whose ownership has not been checked, even when the name agrees.
            || verifiedPlatformId !== counterpart.platformId
            || normalizeArtistName(verifiedArtist.name) !== normalizedName
        ) {
            return null;
        }

        return {
            platform: targetPlatform,
            platformId: verifiedPlatformId,
            ...(counterpart.source === 'wikidata'
                ? {
                    source: 'wikidata' as const,
                    wikidataId: counterpart.wikidataId,
                }
                : {
                    source: 'musicbrainz' as const,
                    musicbrainzId: counterpart.musicbrainzId,
                }),
        };
    } catch (error) {
        console.error(
            `[CrossPlatformArtistResolver] ${targetPlatform} verification failed for ${artist.platform}:${artist.platformId}:`,
            error,
        );
        return null;
    }
}
