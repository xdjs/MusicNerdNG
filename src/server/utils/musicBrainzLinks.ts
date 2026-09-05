/**
 * An artist's links, from a database that already knows them.
 *
 * We had been inferring social accounts from web search: issue queries, fetch
 * pages, judge whether each is about the right person, probe handles, abstain
 * when two answer. Every one of those steps can be wrong, and most of them have
 * been. Meanwhile MusicBrainz is a free, community-curated database whose whole
 * purpose is holding exactly this, and it has entries for six of the seven
 * artists we test against — including the two obscure ones.
 *
 * On those seven it returns the artist's own website (which our corroboration
 * machinery spends a whole search pass hunting for), their Instagram, X,
 * Facebook, SoundCloud, Bandcamp and YouTube, curated by people rather than
 * inferred by us. Hardwell's four match our hand-verified truth exactly,
 * including facebook=djhardwell, which no probe of "hardwell" would ever reach.
 *
 * MATCHING IS THE WHOLE PROBLEM, so it is done by identifier where possible.
 * MusicBrainz links many artists to Spotify and Deezer; where it does and the id
 * is one we already hold, the entry is certainly the right person and its links
 * can be trusted outright. Where it does not — which is the common case for
 * small artists — we require a single candidate whose name matches exactly, and
 * we hand its links to the same verification the search path uses rather than
 * trusting them. Three artists called Black Dave are in our own directory; a
 * name is not an identifier.
 *
 * Rate limited to one request a second by MusicBrainz's terms, and the general
 * discovery path makes two per artist. Reciprocal ID resolution also reuses
 * this queue, but has its own tighter total budget because artist creation is
 * user-facing.
 */

const MB = "https://musicbrainz.org/ws/2";
/** MusicBrainz asks for a contactable agent and blocks generic ones. */
const HEADERS = {
    Accept: "application/json",
    "User-Agent": "MusicNerd/1.0 (https://musicnerd.xyz)",
};
/** Their published limit is one request per second, averaged. */
const RATE_LIMIT_MS = 1_100;
const TIMEOUT_MS = 8_000;
/** User-facing artist creation must remain bounded even when the shared
 *  MusicBrainz queue is busy. Each request is clipped to the remaining budget. */
const RECIPROCAL_BUDGET_MS = 6_000;
const RECIPROCAL_REQUEST_TIMEOUT_MS = 2_500;
const RECIPROCAL_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const RECIPROCAL_NEGATIVE_CACHE_TTL_MS = 60 * 60 * 1_000;
const RECIPROCAL_CACHE_MAX = 1_000;
/** Below this, MusicBrainz's own scorer does not think the name really matched. */
const MIN_SCORE = 90;

type MusicPlatform = "spotify" | "deezer";

export type MusicBrainzCounterpart = {
    platformId: string;
    musicbrainzId: string;
};

type MusicBrainzRequestResult =
    | { status: "ok"; data: Record<string, unknown> }
    | { status: "not-found" }
    | { status: "unavailable" };

type ReciprocalLookupOutcome = {
    counterpart: MusicBrainzCounterpart | null;
    definitiveMiss: boolean;
};

export type MusicBrainzLinks = {
    /** How we know this entry is the right artist. */
    matchedBy: "identifier" | "exact-name";
    /** Every url MusicBrainz holds, for the caller to resolve and verify. */
    urls: string[];
    /** Their official site, if it names one — the hub our search pass hunts for. */
    homepage: string | null;
};

const fold = (v: string) => (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function requestMusicBrainz(
    path: string,
    timeoutMs: number = TIMEOUT_MS,
): Promise<MusicBrainzRequestResult> {
    try {
        const res = await fetch(`${MB}${path}`, {
            headers: HEADERS,
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
            return res.status === 404
                ? { status: "not-found" }
                : { status: "unavailable" };
        }
        const data = await res.json();
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            return { status: "unavailable" };
        }
        return { status: "ok", data: data as Record<string, unknown> };
    } catch {
        return { status: "unavailable" };
    }
}

async function mb(
    path: string,
    timeoutMs: number = TIMEOUT_MS,
): Promise<Record<string, unknown> | null> {
    const result = await requestMusicBrainz(path, timeoutMs);
    return result.status === "ok" ? result.data : null;
}

const wait = (ms: number): Promise<void> => new Promise<void>(r => setTimeout(() => r(), ms));

/**
 * Paces every call in this process, not just the ones inside a single lookup.
 *
 * A bare timestamp did not actually do this, as a review pointed out: two
 * callers arriving together both read the same `lastCallAt`, both compute the
 * same delay, both wake at the same moment and both fire — which is precisely
 * the burst the limit exists to prevent. Two concurrent claim approvals were
 * enough. MusicBrainz answers a throttled request with an entry and no
 * relations, which reads exactly like an artist it has never heard of, so the
 * failure was silent and looked like missing data.
 *
 * Each caller chains onto the previous one and computes its delay only when it
 * reaches the front. A deadline-expired caller skips without sleeping, so a
 * burst of abandoned user-facing lookups cannot leave ghost reservations that
 * block later background work.
 */
let paceQueue: Promise<void> = Promise.resolve();
let lastCallAt = 0;
async function sinceLastCall(deadline: number = Number.POSITIVE_INFINITY): Promise<boolean> {
    let reserved = false;
    let cancelled = false;
    const mine: Promise<void> = paceQueue.then(async () => {
        if (cancelled) return;
        const delay = Math.max(0, lastCallAt + RATE_LIMIT_MS - Date.now());
        if (Date.now() + delay >= deadline) return;
        if (delay > 0) await wait(delay);
        if (cancelled || Date.now() >= deadline) return;
        lastCallAt = Date.now();
        reserved = true;
    });
    // Swallow rejections so one failure cannot poison the queue for everyone.
    paceQueue = mine.then(() => undefined, () => undefined);

    if (!Number.isFinite(deadline)) {
        await mine;
        return reserved;
    }

    const remaining = Math.max(0, deadline - Date.now());
    if (remaining === 0) {
        cancelled = true;
        return false;
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const deadlineReached = new Promise<boolean>((resolve) => {
        timeoutId = setTimeout(() => {
            cancelled = true;
            resolve(false);
        }, remaining);
    });
    const result = await Promise.race([
        mine.then(() => reserved),
        deadlineReached,
    ]);
    if (timeoutId) clearTimeout(timeoutId);
    return result;
}

function isValidPlatformId(platform: MusicPlatform, platformId: string): boolean {
    return platform === "deezer"
        ? /^\d+$/.test(platformId)
        : /^[A-Za-z0-9]{22}$/.test(platformId);
}

function platformArtistUrl(platform: MusicPlatform, platformId: string): string {
    return platform === "spotify"
        ? `https://open.spotify.com/artist/${platformId}`
        : `https://www.deezer.com/artist/${platformId}`;
}

type PlatformArtistUrlMatch =
    | { status: "unrelated" }
    | { status: "invalid" }
    | { status: "valid"; platformId: string };

function matchPlatformArtistUrl(
    url: string,
    platform: MusicPlatform,
): PlatformArtistUrlMatch {
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();
        const validHost = platform === "spotify"
            ? hostname === "open.spotify.com"
            : hostname === "deezer.com" || hostname === "www.deezer.com";
        if (!validHost) return { status: "unrelated" };

        if (
            (parsed.protocol !== "https:" && parsed.protocol !== "http:")
            || parsed.port !== ""
            || parsed.username !== ""
            || parsed.password !== ""
        ) {
            return { status: "invalid" };
        }

        const segments = parsed.pathname.split("/").filter(Boolean);
        const artistSegment = segments.findIndex(segment => segment.toLowerCase() === "artist");
        if (artistSegment < 0) return { status: "unrelated" };
        const canonicalPath = platform === "spotify"
            ? artistSegment === 0 && segments.length === 2 && segments[0] === "artist"
            : (
                (artistSegment === 0 && segments.length === 2 && segments[0] === "artist")
                || (
                    artistSegment === 1
                    && segments.length === 3
                    && /^[a-z]{2}$/.test(segments[0])
                    && segments[1] === "artist"
                )
            );
        if (!canonicalPath) return { status: "invalid" };
        const platformId = segments[artistSegment + 1]?.trim();
        return platformId && isValidPlatformId(platform, platformId)
            ? { status: "valid", platformId }
            : { status: "invalid" };
    } catch {
        return { status: "invalid" };
    }
}

type ActiveRelationsResult =
    | { status: "ok"; relations: Array<Record<string, unknown>> }
    | { status: "invalid" };

type ArtistRelationIdsResult =
    | { status: "ok"; ids: Set<string> }
    | { status: "invalid" };

function activeRelations(data: Record<string, unknown> | null): ActiveRelationsResult {
    const relations = data?.relations;
    if (!Array.isArray(relations)) return { status: "invalid" };

    const active: Array<Record<string, unknown>> = [];
    for (const relation of relations) {
        if (!relation || typeof relation !== "object" || Array.isArray(relation)) {
            return { status: "invalid" };
        }
        const record = relation as Record<string, unknown>;
        if ("ended" in record && typeof record.ended !== "boolean") {
            return { status: "invalid" };
        }
        if (record.ended !== true) active.push(record);
    }
    return { status: "ok", relations: active };
}

function artistRelationIds(data: Record<string, unknown> | null): ArtistRelationIdsResult {
    const active = activeRelations(data);
    if (active.status === "invalid") return active;

    const ids = new Set<string>();
    for (const relation of active.relations) {
        if (relation["target-type"] !== "artist") {
            return { status: "invalid" };
        }
        const artist = relation.artist;
        const id = artist && typeof artist === "object" && !Array.isArray(artist)
            ? (artist as Record<string, unknown>).id
            : undefined;
        if (
            typeof id !== "string"
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
        ) {
            return { status: "invalid" };
        }
        ids.add(id);
    }
    return { status: "ok", ids };
}

function oneValue(values: Iterable<string>): string | null {
    const unique = new Set(values);
    return unique.size === 1 ? unique.values().next().value! : null;
}

function cacheKey(
    sourcePlatform: MusicPlatform,
    sourcePlatformId: string,
    targetPlatform: MusicPlatform,
): string {
    return `${sourcePlatform}:${sourcePlatformId}:${targetPlatform}`;
}

const reciprocalCache = new Map<string, {
    value: MusicBrainzCounterpart | null;
    expiresAt: number;
}>();
const reciprocalLookups = new Map<string, Promise<MusicBrainzCounterpart | null>>();

function readReciprocalCache(key: string): MusicBrainzCounterpart | null | undefined {
    const cached = reciprocalCache.get(key);
    if (!cached) return undefined;
    if (cached.expiresAt <= Date.now()) {
        reciprocalCache.delete(key);
        return undefined;
    }
    return cached.value;
}

function writeReciprocalCache(
    key: string,
    value: MusicBrainzCounterpart | null,
    ttlMs: number,
): void {
    for (const [cachedKey, cached] of reciprocalCache) {
        if (cached.expiresAt <= Date.now()) reciprocalCache.delete(cachedKey);
    }
    if (reciprocalCache.size >= RECIPROCAL_CACHE_MAX) {
        const oldestKey = reciprocalCache.keys().next().value;
        if (oldestKey) reciprocalCache.delete(oldestKey);
    }
    reciprocalCache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs,
    });
}

async function findMusicBrainzCounterpartUncached(
    sourcePlatform: MusicPlatform,
    sourcePlatformId: string,
    targetPlatform: MusicPlatform,
): Promise<ReciprocalLookupOutcome> {
    const deadline = Date.now() + RECIPROCAL_BUDGET_MS;
    if (!(await sinceLastCall(deadline))) {
        return { counterpart: null, definitiveMiss: false };
    }

    const sourceUrl = platformArtistUrl(sourcePlatform, sourcePlatformId);
    const sourceParams = new URLSearchParams({
        resource: sourceUrl,
        inc: "artist-rels",
        fmt: "json",
    });
    const sourceResult = await requestMusicBrainz(
        `/url?${sourceParams.toString()}`,
        Math.max(1, Math.min(RECIPROCAL_REQUEST_TIMEOUT_MS, deadline - Date.now())),
    );
    if (sourceResult.status === "not-found") {
        return { counterpart: null, definitiveMiss: true };
    }
    if (sourceResult.status !== "ok") {
        return { counterpart: null, definitiveMiss: false };
    }
    const sourceLookup = sourceResult.data;
    const sourceOwners = artistRelationIds(sourceLookup);
    if (sourceOwners.status === "invalid") {
        return { counterpart: null, definitiveMiss: false };
    }
    const musicbrainzIds = sourceOwners.ids;
    if (musicbrainzIds.size !== 1) {
        return {
            counterpart: null,
            definitiveMiss: musicbrainzIds.size > 1,
        };
    }
    const musicbrainzId = musicbrainzIds.values().next().value!;
    if (!(await sinceLastCall(deadline))) {
        return { counterpart: null, definitiveMiss: false };
    }

    const detailParams = new URLSearchParams({ inc: "url-rels", fmt: "json" });
    const detail = await mb(
        `/artist/${musicbrainzId}?${detailParams.toString()}`,
        Math.max(1, Math.min(RECIPROCAL_REQUEST_TIMEOUT_MS, deadline - Date.now())),
    );
    if (detail?.id !== musicbrainzId) {
        return { counterpart: null, definitiveMiss: false };
    }

    const detailRelations = activeRelations(detail);
    if (detailRelations.status === "invalid") {
        return { counterpart: null, definitiveMiss: false };
    }
    const relationUrls: string[] = [];
    for (const relation of detailRelations.relations) {
        const url = relation.url;
        const resource = url && typeof url === "object" && !Array.isArray(url)
            ? (url as Record<string, unknown>).resource
            : undefined;
        if (relation["target-type"] !== "url" || typeof resource !== "string") {
            return { counterpart: null, definitiveMiss: false };
        }
        try {
            // Reject partial/malformed relation payloads before deciding that
            // the remaining source and target IDs are unique.
            new URL(resource);
        } catch {
            return { counterpart: null, definitiveMiss: false };
        }
        relationUrls.push(resource);
    }
    const platformRelations = relationUrls.map(url => ({
        url,
        source: matchPlatformArtistUrl(url, sourcePlatform),
        target: matchPlatformArtistUrl(url, targetPlatform),
    }));
    if (platformRelations.some(({ source, target }) => (
        source.status === "invalid" || target.status === "invalid"
    ))) {
        return { counterpart: null, definitiveMiss: false };
    }

    const sourcePlatformIds = new Set(platformRelations.flatMap(({ source }) => (
        source.status === "valid" ? [source.platformId] : []
    )));
    if (sourcePlatformIds.size !== 1 || !sourcePlatformIds.has(sourcePlatformId)) {
        return {
            counterpart: null,
            definitiveMiss: sourcePlatformIds.size > 1,
        };
    }

    // The first lookup verified ownership of this exact canonical resource.
    // Do not let another URL representation for the same platform ID inherit
    // that proof: it may be a separate MusicBrainz URL entity with additional
    // owners. Identical duplicate relation rows are harmless, but aliases fail
    // closed without adding another paced request to the user-facing path.
    const sourceRelationUrls = new Set(platformRelations
        .filter(({ source }) => (
            source.status === "valid" && source.platformId === sourcePlatformId
        ))
        .map(({ url }) => url));
    if (sourceRelationUrls.size !== 1 || !sourceRelationUrls.has(sourceUrl)) {
        return {
            counterpart: null,
            definitiveMiss: sourceRelationUrls.size > 1,
        };
    }

    const platformId = oneValue(platformRelations
        .map(({ target }) => target.status === "valid" ? target.platformId : null)
        .filter((id): id is string => id !== null));
    // At this point MusicBrainz returned a well-formed artist, reconfirmed the
    // exact source ID, and simply has no unique target ID. That is a stable
    // coverage miss (or an ambiguity), so avoid repeating both paced calls on
    // every retry. Transient HTTP/JSON failures above remain uncached.
    if (!platformId) return { counterpart: null, definitiveMiss: true };

    const targetRelationUrls = new Set(platformRelations
        .filter(({ target }) => target.status === "valid" && target.platformId === platformId)
        .map(({ url }) => url));
    if (targetRelationUrls.size !== 1) {
        return {
            counterpart: null,
            definitiveMiss: targetRelationUrls.size > 1,
        };
    }
    const targetRelationUrl = targetRelationUrls.values().next().value!;
    if (!(await sinceLastCall(deadline))) {
        return { counterpart: null, definitiveMiss: false };
    }

    const targetParams = new URLSearchParams({
        resource: targetRelationUrl,
        inc: "artist-rels",
        fmt: "json",
    });
    const targetResult = await requestMusicBrainz(
        `/url?${targetParams.toString()}`,
        Math.max(1, Math.min(RECIPROCAL_REQUEST_TIMEOUT_MS, deadline - Date.now())),
    );
    if (targetResult.status !== "ok") {
        return { counterpart: null, definitiveMiss: false };
    }
    const targetOwners = artistRelationIds(targetResult.data);
    if (targetOwners.status === "invalid") {
        return { counterpart: null, definitiveMiss: false };
    }
    if (targetOwners.ids.size === 0) {
        return { counterpart: null, definitiveMiss: false };
    }
    if (targetOwners.ids.size > 1 || !targetOwners.ids.has(musicbrainzId)) {
        return { counterpart: null, definitiveMiss: true };
    }

    return {
        counterpart: { platformId, musicbrainzId },
        definitiveMiss: false,
    };
}

/**
 * Resolve a Spotify/Deezer counterpart from the exact source URL MusicBrainz
 * stores. This intentionally does no name search: one source URL must belong to
 * one MusicBrainz artist, and that artist must expose one target-platform URL.
 * Provider/name verification remains the caller's responsibility.
 */
export async function findMusicBrainzCounterpart(
    sourcePlatform: MusicPlatform,
    sourcePlatformId: string,
    targetPlatform: MusicPlatform,
): Promise<MusicBrainzCounterpart | null> {
    if (
        sourcePlatform === targetPlatform
        || !isValidPlatformId(sourcePlatform, sourcePlatformId)
    ) {
        return null;
    }

    const key = cacheKey(sourcePlatform, sourcePlatformId, targetPlatform);
    const cached = readReciprocalCache(key);
    if (cached !== undefined) return cached;

    const pending = reciprocalLookups.get(key);
    if (pending) return pending;

    const lookup = findMusicBrainzCounterpartUncached(
        sourcePlatform,
        sourcePlatformId,
        targetPlatform,
    ).then(({ counterpart, definitiveMiss }) => {
        if (counterpart) {
            writeReciprocalCache(key, counterpart, RECIPROCAL_CACHE_TTL_MS);
        } else if (definitiveMiss) {
            writeReciprocalCache(key, null, RECIPROCAL_NEGATIVE_CACHE_TTL_MS);
        }
        return counterpart;
    }).finally(() => {
        reciprocalLookups.delete(key);
    });
    reciprocalLookups.set(key, lookup);
    return lookup;
}

/**
 * Look an artist up and return what MusicBrainz holds, or null when it cannot
 * say confidently who they mean.
 *
 * Never throws: this is an enrichment, and losing it should cost a few links,
 * not the run.
 */
export async function fetchMusicBrainzLinks(
    artistName: string,
    held: { spotify?: string | null; deezer?: string | null },
): Promise<MusicBrainzLinks | null> {
    if (!artistName?.trim()) return null;

    // Their limit is averaged, so back-to-back lookups across several artists
    // exhaust it even when each lookup paces itself internally. A run that gets
    // throttled comes back with an entry and no relations, which reads exactly
    // like an artist MusicBrainz has never heard of — the benchmark saw Pete
    // Rango score 6/7 and 3/7 on consecutive runs for this reason alone.
    await sinceLastCall();

    const search = await mb(`/artist?query=${encodeURIComponent(`artist:"${artistName}"`)}&fmt=json&limit=5`);
    const candidates = ((search?.artists as Array<Record<string, unknown>>) ?? [])
        .filter(a => Number(a.score ?? 0) >= MIN_SCORE);
    if (candidates.length === 0) return null;

    const wantName = fold(artistName);
    let fallback: MusicBrainzLinks | null = null;

    for (const cand of candidates.slice(0, 3)) {
        await sinceLastCall();
        const detail = await mb(`/artist/${String(cand.id)}?inc=url-rels&fmt=json`);
        const relations = (detail?.relations as Array<Record<string, unknown>>) ?? [];
        const urls = relations
            .map(r => (r.url as Record<string, unknown> | undefined)?.resource)
            .filter((u): u is string => typeof u === "string" && u.length > 0);
        if (urls.length === 0) continue;

        const homepage = relations
            .filter(r => r.type === "official homepage")
            .map(r => (r.url as Record<string, unknown> | undefined)?.resource)
            .find((u): u is string => typeof u === "string") ?? null;

        // An id we already hold settles it — this is certainly the same artist,
        // whoever else shares the name.
        // WHOLE path segment, not a substring. `includes("deezer.com/artist/123")`
        // also matches .../1234, so a different artist whose id merely starts
        // with ours was promoted to an IDENTIFIER match — the strongest verdict
        // this module can return, which skips exact-name verification entirely
        // and trusts every link on the wrong entry.
        const idFrom = (u: string, host: string): string | null => {
            try {
                const parsed = new URL(u);
                if (!parsed.hostname.endsWith(host)) return null;
                const seg = parsed.pathname.split("/").filter(Boolean);
                const at = seg.indexOf("artist");
                return at >= 0 ? (seg[at + 1] ?? null) : null;
            } catch { return null; }
        };
        const identifies = urls.some(u =>
            (held.spotify && idFrom(u, "spotify.com") === held.spotify)
            || (held.deezer && idFrom(u, "deezer.com") === held.deezer));
        if (identifies) return { matchedBy: "identifier", urls, homepage };

        // Otherwise remember the first exact-name match and keep looking for an
        // identifier, which outranks it.
        if (!fallback && fold(String(cand.name ?? "")) === wantName) {
            fallback = { matchedBy: "exact-name", urls, homepage };
        }
    }

    // Only when the name is unambiguous here. If several entries scored highly,
    // MusicBrainz is telling us the name is shared and we should not guess.
    if (fallback && candidates.filter(c => fold(String(c.name ?? "")) === wantName).length === 1) {
        return fallback;
    }
    return null;
}
