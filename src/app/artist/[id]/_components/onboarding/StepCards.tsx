"use client";

import { useState, type ReactNode } from "react";
import { MAX_BIO_LENGTH, ARTIST_DOC_MAX_CHARS, ABOUT_TARGET_WORDS } from "@/lib/bioConstants";

// ---------- Profiles: accepted-by-default. Leaving a card as-is IS confirmation. ----------

type ProfileLink = {
    siteName: string;
    value: string;
    displayName?: string;
    logoUrl?: string | null;
    colorHex?: string | null;
    profileUrl?: string | null;
    previewImage?: string | null;
};

// A GUESS, not a confirmed link — surfaced by server-side discovery
// (`profileDiscovery.discoverArtistProfiles`). Same shape as ProfileLink
// (so it can reuse ProfileAvatar/ProfileLogo/profileSubtitle unchanged) plus
// `reasoning` and a non-optional `profileUrl` (discovery only ever returns
// candidates it could build a real, round-tripped click-through URL for).
// Exported so useOnboardingChat.ts can type the live-streamed-candidate
// accumulator without redeclaring this shape.
export type ProfileCandidate = {
    siteName: string;
    value: string;
    displayName: string;
    logoUrl: string | null;
    colorHex: string | null;
    profileUrl: string;
    previewImage: string | null;
    reasoning: string | null;
};

type ProfilesPayload = {
    artistName: string;
    links: ProfileLink[];
    candidates?: ProfileCandidate[];
    enrichment: { platform: string; followerCount: number | null; imageUrl: string | null } | null;
};

// The full set of platforms MusicNerd's onboarding treats as "your profiles"
// — mirrors `PROFILE_DISPLAY_COLUMNS` in `src/server/utils/linkPresentation.ts`.
// Used only for the "still missing" hint below the candidates section; keep
// the two lists in sync if that server-side set ever changes.
const SUPPORTED_PLATFORM_LABELS: Record<string, string> = {
    spotify: "Spotify", deezer: "Deezer", instagram: "Instagram", tiktok: "TikTok",
    x: "X", youtube: "YouTube", soundcloud: "SoundCloud", bandcamp: "Bandcamp",
    twitch: "Twitch", facebook: "Facebook",
};
const SUPPORTED_PLATFORMS = Object.keys(SUPPORTED_PLATFORM_LABELS);

/** siteNames we found exactly one candidate for — the confident matches. */
function unambiguousCandidateSiteNames(candidates: { siteName: string }[]): string[] {
    const counts = new Map<string, number>();
    for (const c of candidates) counts.set(c.siteName, (counts.get(c.siteName) ?? 0) + 1);
    return [...counts.entries()].filter(([, n]) => n === 1).map(([siteName]) => siteName);
}

/** Which supported platforms a pasted URL covers, by host.
 *
 *  Host-based rather than regex-based on purpose: the real matching lives
 *  server-side in `urlmap` and this is only feeding a hint. Every supported
 *  platform has a distinctive registrable domain, so this is exact enough —
 *  and matching on the host segment rather than a substring keeps "x" from
 *  matching every hostname containing the letter. */
function platformsInUrl(raw: string): string[] {
    let host: string;
    try {
        host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
            .hostname.replace(/^www\./, "").toLowerCase();
    } catch {
        return [];
    }
    return SUPPORTED_PLATFORMS.filter(p => host === p || host.startsWith(`${p}.`) || host.includes(`.${p}.`));
}

// siteNames whose stored value is a platform-issued opaque ID, never a human
// handle — never render these raw (see PROFILE_HANDLE_SITENAMES below for the
// inverse: platforms where the value IS a readable handle worth showing as-is).
const PROFILE_OPAQUE_ID_SITENAMES = new Set(["spotify", "youtubechannel", "facebookID", "tiktokID", "soundcloudID"]);
const PROFILE_HANDLE_SITENAMES = new Set(["instagram", "x", "tiktok", "youtube"]);
const OPAQUE_VALUE_LENGTH = 20;

// Fix 3: past this many rows, a card's list of links/sources can blow well
// past the panel's height and bury its confirm button below the fold. Cap the
// LIST in its own scroll region (paste-row + confirm button stay outside it,
// always reachable) rather than letting the whole card grow unbounded.
const PROFILES_SCROLL_THRESHOLD = 6;
const VAULT_SCROLL_THRESHOLD = 4;

function isOpaqueId(link: ProfileLink): boolean {
    // A purely numeric value (e.g. a Deezer artist ID like "4050205", or a
    // numeric Facebook/TikTok page ID) is never a human-readable handle,
    // regardless of length — same "meaningless ID" defect as the long opaque
    // strings below.
    return (
        PROFILE_OPAQUE_ID_SITENAMES.has(link.siteName) ||
        link.value.length > OPAQUE_VALUE_LENGTH ||
        /^\d+$/.test(link.value)
    );
}

function fmtFollowers(n: number) {
    return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}K` : `${n}`;
}

/** The human-readable line under the platform name — never the raw ID for
 *  opaque values (spec: "Spotify 3DmaZbBPnKSGnxYRpHobss" is meaningless). */
function profileSubtitle(link: ProfileLink): string | null {
    if (isOpaqueId(link)) return null;
    return PROFILE_HANDLE_SITENAMES.has(link.siteName) ? `@${link.value}` : link.value;
}

function ProfileLogo({ link }: { link: ProfileLink }) {
    const color = link.colorHex ?? undefined;
    const tintStyle = color ? { backgroundColor: `${color}26`, boxShadow: `inset 0 0 0 1px ${color}66` } : undefined;
    if (link.logoUrl) {
        return (
            <span className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center overflow-hidden bg-black/5 dark:bg-white/10" style={tintStyle}>
                {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size third-party logo; next/image would require a next.config domain change */}
                <img src={link.logoUrl} alt="" className="w-5 h-5 object-contain" />
            </span>
        );
    }
    const initial = (link.displayName ?? link.siteName).charAt(0).toUpperCase();
    return (
        <span
            className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold text-black dark:text-white bg-black/10 dark:bg-white/10"
            style={tintStyle}
        >
            {initial}
        </span>
    );
}

/** Leading visual for a profile row. When `previewImage` resolved (the
 *  artist's real photo, e.g. from Spotify's oEmbed thumbnail or an og:image
 *  scrape), render it as a compact ~40px avatar with the platform logo as a
 *  small corner badge overlapping it — an iMessage/Slack-style unfurl instead
 *  of a bare platform tile. Falls back to the plain logo tile when there's no
 *  preview, or if the image fails to load. */
function ProfileAvatar({ link }: { link: ProfileLink }) {
    const [imgFailed, setImgFailed] = useState(false);
    if (!link.previewImage || imgFailed) {
        return <ProfileLogo link={link} />;
    }
    const color = link.colorHex ?? undefined;
    const ringStyle = color ? { boxShadow: `0 0 0 2px ${color}99` } : undefined;
    return (
        <span className="relative flex-shrink-0 w-10 h-10 rounded-full" style={ringStyle}>
            {/* eslint-disable-next-line @next/next/no-img-element -- user-controlled preview image; next/image would require a next.config domain allowlist */}
            <img
                src={link.previewImage}
                alt=""
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                className="w-10 h-10 rounded-full object-cover bg-black/5 dark:bg-white/10"
            />
            {link.logoUrl && (
                <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full overflow-hidden bg-white dark:bg-black ring-1 ring-white dark:ring-black flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size third-party logo badge; next/image would require a next.config domain change */}
                    <img src={link.logoUrl} alt="" referrerPolicy="no-referrer" className="w-3 h-3 object-contain" />
                </span>
            )}
        </span>
    );
}

/** A single discovered-but-unconfirmed profile suggestion. Opt-in by design
 *  (the inverse of a confirmed ProfileLink row): nothing here is submitted
 *  unless the artist explicitly clicks "Add" — see the ProfilesCard doc
 *  comment for why confirmed links and candidates use opposite defaults. */
function CandidateRow({ candidate, accepted, onToggleAccept, onDismiss, disabled }: {
    candidate: ProfileCandidate;
    accepted: boolean;
    onToggleAccept: () => void;
    onDismiss: () => void;
    disabled: boolean;
}) {
    const subtitle = profileSubtitle(candidate);
    return (
        <div
            className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 transition-colors ${
                accepted
                    ? "border-green-500/50 bg-green-500/10"
                    : "border-dashed border-black/15 dark:border-white/15 hover:border-black/25 dark:hover:border-white/25"
            }`}
        >
            <div className="flex items-center gap-3 min-w-0">
                <ProfileAvatar link={candidate} />
                <a
                    href={candidate.profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={candidate.reasoning ?? undefined}
                    className="min-w-0 rounded hover:underline focus:outline-none focus:ring-2 focus:ring-pink-500"
                >
                    <span className="font-medium text-black dark:text-white inline-flex items-center gap-1">
                        {candidate.displayName}
                        <span aria-hidden="true" className="text-gray-500 dark:text-gray-400 text-xs">↗</span>
                    </span>
                    {subtitle && <span className="block text-sm text-gray-600 dark:text-gray-300 break-all">{subtitle}</span>}
                </a>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                    type="button"
                    aria-label={`add ${candidate.siteName} profile`}
                    onClick={onToggleAccept}
                    disabled={disabled}
                    className={`text-sm px-2 py-1 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        accepted
                            ? "border-green-500 text-green-600 dark:text-green-400"
                            : "border-pink-500 text-pink-500 enabled:hover:bg-pink-500/10"
                    }`}
                >
                    {accepted ? "Added ✓" : "Add"}
                </button>
                <button
                    type="button"
                    aria-label={`dismiss ${candidate.siteName} suggestion`}
                    onClick={onDismiss}
                    disabled={disabled}
                    className="text-sm px-2 py-1 rounded-lg text-gray-600 dark:text-gray-300 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    Not me
                </button>
            </div>
        </div>
    );
}

// Caps how much a burst of simultaneously-arriving candidates staggers by —
// enough to read as a sequence, not so much that a late arrival (e.g. the
// 6th of 6) feels like it's waiting on its own entrance.
const CANDIDATE_STAGGER_STEP_MS = 60;
const CANDIDATE_STAGGER_MAX_STEPS = 5;

/** Live discovery feed — the "magic" moment: renders each candidate the
 *  instant its `candidate` SSE event arrives, one row appearing at a time as
 *  discovery finds them, instead of the whole search running silently and
 *  dumping a finished list. Read-only (no Add/Not-me here — that opt-in
 *  decision lives in the terminal `ProfilesCard`'s candidates section, which
 *  reconciles this same data once the step completes). Renders nothing until
 *  the first candidate lands, so it never shows an empty "finding…" shell
 *  ahead of real results.
 *
 *  Each row fades + rises in on mount (`animate-onboarding-panel-in`, same
 *  entrance used for the whole chat panel — see globals.css, which already
 *  disables it under prefers-reduced-motion). Rows already on screen never
 *  replay it: React keeps their DOM node across re-renders (keyed by
 *  `siteName`), so only a genuinely new arrival mounts fresh. A per-index
 *  `animationDelay` staggers a same-tick burst (candidate SSE events that
 *  land in one batched React update) into a visible sequence instead of a
 *  simultaneous jump; well-spaced arrivals just get a small, capped head
 *  start that isn't perceptible as lag. */
export function LiveDiscoveryFeed({ candidates }: { candidates: ProfileCandidate[] }) {
    if (candidates.length === 0) return null;
    return (
        <div className="glass-subtle rounded-2xl rounded-bl-md px-3.5 py-3 max-w-[80%] self-start space-y-2" data-testid="live-discovery-feed">
            <p className="text-xs font-medium text-gray-600 dark:text-gray-300 px-0.5">Finding your profiles…</p>
            <div className="space-y-1.5">
                {candidates.map((candidate, i) => {
                    const subtitle = profileSubtitle(candidate);
                    const delayMs = Math.min(i, CANDIDATE_STAGGER_MAX_STEPS) * CANDIDATE_STAGGER_STEP_MS;
                    return (
                        <div
                            key={candidate.siteName}
                            className="flex items-center gap-2.5 rounded-lg px-1 py-1 animate-onboarding-panel-in"
                            style={{ animationDelay: `${delayMs}ms` }}
                        >
                            <ProfileAvatar link={candidate} />
                            <div className="min-w-0">
                                <span className="text-sm font-medium text-black dark:text-white">{candidate.displayName}</span>
                                {subtitle && <span className="block text-xs text-gray-600 dark:text-gray-300 break-all">{subtitle}</span>}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export function ProfilesCard({ payload, onConfirm, onFindMore, disabled }: {
    payload: ProfilesPayload;
    onConfirm: (r: { addedLinks: { url: string }[]; removedSiteNames: string[] }) => void;
    /** Re-runs discovery, carrying the SAME decisions as onConfirm so the
     *  artist's confirmations and removals survive the re-search. It used to
     *  take no arguments, which is how a real artist lost four confirmed
     *  profiles and was shown them again as unconfirmed candidates. Optional so
     *  the card still renders in tests and for any caller without a re-search. */
    onFindMore?: (r: { addedLinks: { url: string }[]; removedSiteNames: string[] }) => void;
    disabled: boolean;
}) {
    const [removed, setRemoved] = useState<Set<string>>(new Set());
    const [added, setAdded] = useState<string[]>([]);
    const [draft, setDraft] = useState("");
    // A discovered profile for a platform we found EXACTLY ONE candidate for is
    // pre-accepted, like a confirmed link. Decided 2026-08-20 (Carl: the goal is
    // to get the profile created, so the quickest path wins) and not implemented
    // until an artist lost every one of his socials to it: candidates were
    // opt-in while the card's own first line said "Leaving a card as-is confirms
    // it". He read that, left the card alone, completed all four steps, and
    // ended with only the Deezer link he started with.
    //
    // Platforms with SEVERAL candidates are excluded entirely rather than
    // pre-accepted — CY, same meeting: unchecking your own old profiles feels
    // worse than adding the right one. They fall through to "Still missing", so
    // the artist is asked to paste the correct one. (This also avoids a real
    // defect: `accepted` is keyed by siteName, so accepting one of two
    // same-platform candidates would have saved both, and they collide as React
    // keys besides.)
    const [accepted, setAccepted] = useState<Set<string>>(
        () => new Set(unambiguousCandidateSiteNames(payload.candidates ?? [])),
    );
    const [dismissed, setDismissed] = useState<Set<string>>(new Set());

    const toggleRemoved = (siteName: string) => {
        setRemoved(prev => {
            const next = new Set(prev);
            if (next.has(siteName)) next.delete(siteName); else next.add(siteName);
            return next;
        });
    };

    const toggleAccepted = (siteName: string) => {
        setAccepted(prev => {
            const next = new Set(prev);
            if (next.has(siteName)) next.delete(siteName); else next.add(siteName);
            return next;
        });
    };

    const dismissCandidate = (siteName: string) => {
        setDismissed(prev => new Set(prev).add(siteName));
        // Dismissing an already-accepted suggestion must also un-accept it —
        // a dismissed candidate can never end up in the submitted payload.
        setAccepted(prev => {
            if (!prev.has(siteName)) return prev;
            const next = new Set(prev);
            next.delete(siteName);
            return next;
        });
    };

    // Only the confident matches are shown. A platform with several candidates
    // is dropped here rather than offered — see the `accepted` note above — so
    // it surfaces in "Still missing" and the artist pastes the right one.
    const allCandidates = payload.candidates ?? [];
    const unambiguous = new Set(unambiguousCandidateSiteNames(allCandidates));
    const candidates = allCandidates.filter(c => unambiguous.has(c.siteName));
    /** The artist's decisions, in the shape both buttons send. Built in ONE place
     *  so "Looks good, continue" and "Look for more" can never disagree about
     *  what the artist just told us. */
    const decisions = () => ({
        addedLinks: [
            ...added.map(url => ({ url })),
            ...candidates.filter(c => accepted.has(c.siteName)).map(c => ({ url: c.profileUrl })),
        ],
        removedSiteNames: [...removed],
    });

    const visibleCandidates = candidates.filter(c => !dismissed.has(c.siteName));

    // "Still missing" hint: platforms with neither a confirmed link nor even
    // a discovered lead — makes the paste-a-link ask concrete instead of
    // open-ended once there's something to react to.
    const coveredSiteNames = new Set([
        ...payload.links.filter(l => !removed.has(l.siteName)).map(l => l.siteName),
        ...candidates.map(c => c.siteName),
        // Links the artist has pasted in THIS card but not submitted yet. They
        // live in local state, so without this the hint kept telling a real
        // artist "Still missing: TikTok" on the line directly below the TikTok
        // link he had just added.
        ...added.flatMap(platformsInUrl),
    ]);
    const stillMissing = SUPPORTED_PLATFORMS.filter(p => !coveredSiteNames.has(p));

    const isEmpty = payload.links.length === 0;
    // Fix 3: cap the list itself, not the whole card — the paste row and the
    // confirm button below stay outside this region so they're always
    // reachable without hunting through a long scroll.
    const manyLinks = payload.links.length > PROFILES_SCROLL_THRESHOLD;
    const listClassName = manyLinks
        ? "space-y-2 max-h-[40vh] overflow-y-auto overscroll-contain scrollbar-glass pr-1"
        : "space-y-2";

    return (
        <div className="glass-subtle rounded-xl p-4 space-y-2 w-full">
            <div data-testid="profiles-link-list" className={listClassName}>
                {payload.links.map(link => {
                    const displayName = link.displayName || link.siteName.charAt(0).toUpperCase() + link.siteName.slice(1);
                    const subtitle = profileSubtitle(link);
                    const showFollowers = payload.enrichment && link.siteName === payload.enrichment.platform && payload.enrichment.followerCount != null;
                    const nameBlock = (
                        <div className="min-w-0">
                            <span className="font-medium text-black dark:text-white inline-flex items-center gap-1">
                                {displayName}
                                {link.profileUrl && (
                                    <svg aria-hidden="true" viewBox="0 0 24 24" className="w-3 h-3 text-gray-500 dark:text-gray-400 flex-shrink-0">
                                        <path fill="currentColor" d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
                                    </svg>
                                )}
                            </span>
                            {subtitle && <span className="block text-sm text-gray-600 dark:text-gray-300 break-all">{subtitle}</span>}
                            {showFollowers && (
                                <span className="block text-xs text-gray-600 dark:text-gray-300">{fmtFollowers(payload.enrichment!.followerCount!)} fans</span>
                            )}
                        </div>
                    );
                    return (
                        <div
                            key={link.siteName}
                            className={`flex items-center justify-between gap-2 rounded-lg border border-black/10 dark:border-white/10 px-3 py-2 ${removed.has(link.siteName) ? "opacity-40 line-through" : ""}`}
                        >
                            <div className="flex items-center gap-3 min-w-0">
                                <ProfileAvatar link={link} />
                                {link.profileUrl ? (
                                    <a
                                        href={link.profileUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="min-w-0 rounded hover:underline focus:outline-none focus:ring-2 focus:ring-pink-500"
                                    >
                                        {nameBlock}
                                    </a>
                                ) : (
                                    nameBlock
                                )}
                            </div>
                            <button
                                aria-label={`remove ${link.siteName}`}
                                onClick={() => toggleRemoved(link.siteName)}
                                disabled={disabled}
                                className="text-gray-600 dark:text-gray-300 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded-full px-2 py-1"
                            >
                                ✕
                            </button>
                        </div>
                    );
                })}
            </div>
            {isEmpty && added.length === 0 && visibleCandidates.length === 0 && (
                <div className="text-sm text-gray-600 dark:text-gray-300 px-1 py-2">
                    No profiles linked yet — paste one below whenever you&apos;re ready.
                </div>
            )}
            {visibleCandidates.length > 0 && (
                <div className="pt-2 space-y-2.5">
                    <div className="flex items-center gap-2">
                        <div className="h-px flex-1 bg-black/10 dark:bg-white/10" />
                        <p className="text-xs font-medium text-gray-600 dark:text-gray-300 whitespace-nowrap">
                            We also found these — confirm the ones that are yours
                        </p>
                        <div className="h-px flex-1 bg-black/10 dark:bg-white/10" />
                    </div>
                    <div data-testid="profiles-candidate-list" className="space-y-2">
                        {visibleCandidates.map(candidate => (
                            <CandidateRow
                                key={candidate.siteName}
                                candidate={candidate}
                                accepted={accepted.has(candidate.siteName)}
                                onToggleAccept={() => toggleAccepted(candidate.siteName)}
                                onDismiss={() => dismissCandidate(candidate.siteName)}
                                disabled={disabled}
                            />
                        ))}
                    </div>
                </div>
            )}
            {added.map(url => (
                <div key={url} className="text-sm text-green-600 dark:text-green-400 px-3">+ {url}</div>
            ))}
            {stillMissing.length > 0 && (
                <p className="text-xs text-gray-600 dark:text-gray-300 px-1">
                    Still missing: {stillMissing.map(p => SUPPORTED_PLATFORM_LABELS[p]).join(", ")} — paste a link below if you have one.
                </p>
            )}
            <div className="flex gap-2 pt-1">
                <input
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    placeholder="Paste a profile we missed…"
                    aria-label="Add a missing profile link"
                    disabled={disabled}
                    className="flex-1 rounded-lg border border-black/10 dark:border-white/10 bg-transparent px-3 py-2 text-sm text-black dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-pink-500 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <button
                    onClick={() => { if (draft.trim()) { setAdded(prev => [...prev, draft.trim()]); setDraft(""); } }}
                    disabled={disabled || !draft.trim()}
                    className="text-sm px-3 py-2 rounded-lg border border-pink-500 text-pink-500 enabled:hover:bg-pink-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    Add
                </button>
            </div>
            <button
                onClick={() => onConfirm(decisions())}
                disabled={disabled}
                className="w-full bg-pink-500 enabled:hover:bg-pink-600 active:bg-pink-700 transition-colors text-white font-semibold py-2.5 rounded-lg mt-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {isEmpty ? "Continue" : "Looks good, continue"}
            </button>
            {/* Discovery works through tiers under a time budget, so a slow run returns
                fewer profiles than a fast one for the same artist. This gives them a way
                to ask for another pass instead of assuming what they see is everything.
                Secondary by design — most artists should just continue. */}
            {onFindMore && (
                <button
                    onClick={() => onFindMore(decisions())}
                    disabled={disabled}
                    className="w-full text-sm py-2 rounded-lg border border-pink-500 text-pink-500 enabled:hover:bg-pink-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    Look for more
                </button>
            )}
        </div>
    );
}

// ---------- Vault: keep-by-default ----------

type VaultPayload = {
    sources: { id: string; title: string | null; url: string; snippet: string | null; ogImage?: string | null; verified?: boolean }[];
};

/** The domain line of a real link unfurl (e.g. "pitchfork.com") — helps the
 *  artist judge a source's credibility at a glance. Returns null on an
 *  unparseable URL rather than throwing. */
function sourceDomain(url: string): string | null {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return null;
    }
}

/** Leading thumbnail for a vault source that has an `ogImage`. Hides itself
 *  on load failure (no logo-tile equivalent to fall back to for arbitrary
 *  web sources — the row just reverts to today's text-only layout). */
function VaultThumbnail({ src }: { src: string }) {
    const [failed, setFailed] = useState(false);
    if (failed) return null;
    return (
        // eslint-disable-next-line @next/next/no-img-element -- user-controlled source image; next/image would require a next.config domain allowlist
        <img
            src={src}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="flex-shrink-0 w-14 h-14 rounded-lg object-cover bg-black/5 dark:bg-white/10"
        />
    );
}

export function VaultCard({ payload, onConfirm, disabled }: {
    payload: VaultPayload;
    onConfirm: (r: { decisions: { sourceId: string; status: "approved" | "rejected" }[]; addedUrls: string[] }) => void;
    disabled: boolean;
}) {
    const [skipped, setSkipped] = useState<Set<string>>(new Set());
    const [added, setAdded] = useState<string[]>([]);
    const [draft, setDraft] = useState("");

    const toggle = (id: string) => setSkipped(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const submit = () => onConfirm({
        decisions: payload.sources.map(s => ({
            sourceId: s.id,
            status: skipped.has(s.id) ? "rejected" as const : "approved" as const,
        })),
        addedUrls: added,
    });

    // Fix 3: cap the list itself, not the whole card — the paste row and the
    // "Keep these, continue" button below stay outside this region so they're
    // always reachable without hunting through a long scroll of sources.
    const manySources = payload.sources.length > VAULT_SCROLL_THRESHOLD;
    const listClassName = manySources
        ? "space-y-2 max-h-[40vh] overflow-y-auto overscroll-contain scrollbar-glass pr-1"
        : "space-y-2";

    return (
        <div className="glass-subtle rounded-xl p-4 space-y-2 w-full">
            <div data-testid="vault-source-list" className={listClassName}>
                {payload.sources.map(s => {
                    const domain = s.ogImage ? sourceDomain(s.url) : null;
                    return (
                        <div
                            key={s.id}
                            className={`rounded-lg border border-black/10 dark:border-white/10 px-3 py-2 flex items-start gap-3 ${skipped.has(s.id) ? "opacity-40" : ""}`}
                        >
                            {s.ogImage && <VaultThumbnail src={s.ogImage} />}
                            <div className="min-w-0 flex-1 flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    {/* The title is the link. Curating sources you cannot open
                                        is guesswork — every source here goes straight to the page
                                        it claims to be, so a wrong one can be caught by clicking. */}
                                    <a
                                        href={s.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="font-medium truncate block text-black dark:text-white hover:text-pink-600 dark:hover:text-pink-400 hover:underline"
                                    >
                                        {s.title ?? s.url}
                                    </a>
                                    {s.snippet && <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">{s.snippet}</p>}
                                    <div className="flex items-center gap-2 min-w-0">
                                        {(domain ?? sourceDomain(s.url)) && (
                                            <p className="text-xs text-gray-600 dark:text-gray-300 truncate">{domain ?? sourceDomain(s.url)}</p>
                                        )}
                                        {s.verified === false && (
                                            <span
                                                title="We couldn't read this page, so its description above is unconfirmed. Open it to check — nothing unverified is used to write your About."
                                                className="shrink-0 text-[0.68rem] uppercase tracking-wide px-1.5 py-0.5 rounded border border-amber-500/50 text-amber-700 dark:text-amber-300"
                                            >
                                                unverified
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <button
                                    aria-label={`${skipped.has(s.id) ? "keep" : "skip"} ${s.title ?? s.url}`}
                                    onClick={() => toggle(s.id)}
                                    disabled={disabled}
                                    className="text-sm whitespace-nowrap px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:border-pink-400 dark:hover:border-pink-400 hover:text-pink-600 dark:hover:text-pink-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                    {skipped.has(s.id) ? "keep" : "skip"}
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
            {added.map(url => (
                <div key={url} className="text-sm text-green-600 dark:text-green-400 px-3">+ {url}</div>
            ))}
            <div className="flex gap-2 pt-1">
                <input
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    placeholder="Paste press, an interview, a feature, your site…"
                    aria-label="Add a source link"
                    disabled={disabled}
                    className="flex-1 rounded-lg border border-black/10 dark:border-white/10 bg-transparent px-3 py-2 text-sm text-black dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-pink-500 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <button
                    onClick={() => { if (draft.trim()) { setAdded(prev => [...prev, draft.trim()]); setDraft(""); } }}
                    disabled={disabled || !draft.trim()}
                    className="text-sm px-3 py-2 rounded-lg border border-pink-500 text-pink-500 enabled:hover:bg-pink-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    Add
                </button>
            </div>
            <button
                onClick={submit}
                disabled={disabled}
                className="w-full bg-pink-500 enabled:hover:bg-pink-600 active:bg-pink-700 transition-colors text-white font-semibold py-2.5 rounded-lg mt-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {payload.sources.length > 0 ? "Keep these, continue" : "Continue"}
            </button>
        </div>
    );
}

// ---------- Interview ----------

// A grounded question carries the real Instagram post URL(s) it was drawn
// from — exported so OnboardingChat.tsx can read `payload.question` when
// round-tripping the interview_answer turn (see turnHandlers.ts's
// resolveInterviewQuestionText for why that round-trip is needed).
export type InterviewPayload = { questionKey: string; question: string; number: number; total: number; sourceUrls?: string[] };

// "One or two links, not a wall" — supporting evidence, not the headline.
const MAX_VISIBLE_SOURCE_URLS = 2;

function sourceUrlLabel(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return url;
    }
}

/** Small, subtle "what prompted this" affordance under a grounded question —
 *  renders nothing when there's no source to point to (a static fallback
 *  question, or a grounded one that somehow lost its evidence). */
function QuestionSources({ sourceUrls }: { sourceUrls?: string[] }) {
    if (!sourceUrls || sourceUrls.length === 0) return null;
    const visible = sourceUrls.slice(0, MAX_VISIBLE_SOURCE_URLS);
    return (
        <p className="text-xs text-gray-500/80 dark:text-gray-400/80">
            What prompted this:{" "}
            {visible.map((url, i) => (
                <span key={url}>
                    {i > 0 && ", "}
                    <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline decoration-dotted underline-offset-2 hover:decoration-solid hover:text-pink-500 dark:hover:text-pink-400 transition-colors"
                    >
                        {sourceUrlLabel(url)}
                    </a>
                </span>
            ))}
        </p>
    );
}

export function InterviewInput({ payload, onAnswer, disabled }: {
    payload: InterviewPayload;
    onAnswer: (r: { questionKey: string; answer: string | null }) => void;
    disabled: boolean;
}) {
    const [draft, setDraft] = useState("");
    return (
        <div className="w-full space-y-2">
            <p className="text-xs text-gray-700 dark:text-gray-300">Question {payload.number} of {payload.total} — all optional</p>
            <QuestionSources sourceUrls={payload.sourceUrls} />
            <div className="flex gap-2">
                <input
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && draft.trim()) onAnswer({ questionKey: payload.questionKey, answer: draft.trim() }); }}
                    placeholder="Type your answer…"
                    aria-label="Your answer"
                    disabled={disabled}
                    className="flex-1 rounded-lg border border-black/10 dark:border-white/10 bg-transparent px-3 py-2 text-black dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-pink-500 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <button
                    onClick={() => onAnswer({ questionKey: payload.questionKey, answer: draft.trim() })}
                    disabled={disabled || !draft.trim()}
                    className="bg-pink-500 enabled:hover:bg-pink-600 transition-colors text-white font-semibold px-4 py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    Send
                </button>
            </div>
            <button
                onClick={() => onAnswer({ questionKey: payload.questionKey, answer: null })}
                disabled={disabled}
                className="text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white underline disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
                Skip this one
            </button>
        </div>
    );
}

// ---------- Citations: shared by the knowledge doc panel and the About ----------

// Mirrors DocSource in src/server/utils/artistDocService.ts — kept as an
// independently-declared client-side type (same shape) rather than importing
// server code into a "use client" component. `url` is null for an interview
// citation (the artist's own words have no external link to point to).
export type DocSource = {
    id: number;
    kind: "vault" | "interview" | "social";
    label: string;
    url: string | null;
};

/** Turns any `[n]` marker in `text` into a small superscript citation —
 *  a link when the source has a url, a plain labelled superscript (its title
 *  attribute carries the source) when it doesn't (interview citations). A
 *  marker with no matching source is dropped silently: the server already
 *  strips anything that doesn't resolve to a real id before this ever runs
 *  (see validateCitations in artistDocService.ts) — this is defense in depth,
 *  never the primary guard against a hallucinated citation reaching the UI. */
function renderWithCitations(text: string, sources: DocSource[]) {
    if (sources.length === 0 || !/\[\d+\]/.test(text)) return text;
    const byId = new Map(sources.map(s => [s.id, s]));
    return text.split(/(\[\d+\])/g).map((part, i) => {
        const m = part.match(/^\[(\d+)\]$/);
        if (!m) return part || null;
        const source = byId.get(Number(m[1]));
        if (!source) return null;
        const className = "text-[0.7em] align-super mx-px";
        // A citation with no URL is the artist's OWN words from the interview —
        // there is no page to link to. Styling it identically to a link made it
        // read as a broken one ("28 and 29 aren't clickable"), so it gets its own
        // treatment: a different colour and a dotted underline, which says
        // "annotation, hover me" rather than "link, and it's broken".
        return source.url ? (
            <sup key={i}>
                <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={source.label}
                    className={`${className} text-pink-500 dark:text-pink-400 hover:underline`}
                >
                    [{m[1]}]
                </a>
            </sup>
        ) : (
            <sup
                key={i}
                title={`${source.label} — your own words, from the interview`}
                className={`${className} text-emerald-600 dark:text-emerald-400 cursor-help decoration-dotted underline underline-offset-2`}
            >
                [{m[1]}]
            </sup>
        );
    });
}

// Matches both the doc's `##` section headers AND the worked example's `#`
// title line ("# ARTIST NAME - Artist Knowledge Document") — Gemini imitates
// the worked example closely enough that real output opens with one (see the
// live Pete Rango run). Without this, an H1 line fell through to the plain
// paragraph branch and rendered as unstyled body text.
const HEADING_RE = /^(#{1,2})\s+(.*)$/;
const BULLET_RE = /^[-*]\s+(.*)$/;

/** Renders the limited markdown subset the doc synthesis prompt is instructed
 *  to emit — `##` headers, `-`/`*` bullets, and plain paragraph lines — by
 *  hand, with no markdown dependency (spec constraint: no new deps). Good
 *  enough for exactly this doc's shape; not a general markdown renderer. */
function renderDocBody(doc: string, sources: DocSource[]) {
    const blocks: ReactNode[] = [];
    let list: string[] = [];
    let key = 0;
    const flushList = () => {
        if (list.length > 0) {
            blocks.push(
                <ul key={`ul${key++}`} className="list-disc pl-5 space-y-1">
                    {list.map((item, i) => <li key={i}>{renderWithCitations(item, sources)}</li>)}
                </ul>
            );
        }
        list = [];
    };
    for (const rawLine of doc.split("\n")) {
        const line = rawLine.trim();
        if (!line) { flushList(); continue; }
        const heading = line.match(HEADING_RE);
        const bullet = line.match(BULLET_RE);
        if (heading) {
            flushList();
            const isTitle = heading[1] === "#";
            const HeadingTag = isTitle ? "h3" : "h4";
            blocks.push(
                <HeadingTag
                    key={`h${key++}`}
                    className={isTitle
                        ? "font-bold text-black dark:text-white text-base mt-0"
                        : "font-bold text-pink-500 text-sm mt-3 first:mt-0"}
                >
                    {heading[2]}
                </HeadingTag>
            );
        } else if (bullet) {
            list.push(bullet[1]);
        } else {
            flushList();
            blocks.push(<p key={`p${key++}`} className="leading-relaxed">{renderWithCitations(line, sources)}</p>);
        }
    }
    flushList();
    return blocks;
}

// ---------- Knowledge document review: read it, fix it, then choose ----------

/** The knowledge document, shown on its own BEFORE any About exists, with the
 *  two things reading it is for: correcting what's wrong, and deciding who
 *  writes the About.
 *
 *  This ordering is the product owner's: "it should have shown me my knowledge
 *  document and encouraged me to fact check — once that's done THEN we get asked
 *  if we want to fill in an About section or if we'd like to write it based off
 *  of the knowledge base." Previously the About was generated in the same breath
 *  as the document and shown above it, which asked the artist to approve prose
 *  drawn from a record they had not checked.
 *
 *  Corrections are made to the document text itself and round-trip back to the
 *  server, so the About is generated from the approved version — not the one we
 *  produced. */
export function DocReviewCard({ doc, sources = [], onChoose, disabled }: {
    doc: string;
    sources?: DocSource[];
    onChoose: (r: { mode: "generate" | "self"; doc: string }) => void;
    disabled: boolean;
}) {
    const [isEditing, setIsEditing] = useState(false);
    const [docText, setDocText] = useState(doc);

    const isEmpty = docText.trim().length === 0;
    const overCap = docText.length > ARTIST_DOC_MAX_CHARS;
    const blocked = disabled || isEmpty || overCap;

    return (
        <div className="glass-subtle rounded-xl p-4 space-y-3 w-full" data-testid="doc-review-card">
            <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-bold text-pink-500">Your knowledge document</h3>
                <button
                    type="button"
                    onClick={() => setIsEditing(prev => !prev)}
                    disabled={disabled}
                    className="flex-none text-sm px-3 py-1.5 rounded-lg border border-pink-500 text-pink-500 enabled:hover:bg-pink-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    {isEditing ? "Done" : "Fix something"}
                </button>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-300">
                Please read this before we go further — everything else gets built from it.
                Pink citations link to the page a claim came from, so you can check it. Green ones are your own words
                from the interview. Anything that&apos;s wrong, fix it here.
            </p>
            {isEditing ? (
                <div className="space-y-1.5">
                    <textarea
                        value={docText}
                        onChange={e => setDocText(e.target.value)}
                        disabled={disabled}
                        rows={20}
                        aria-label="Edit your knowledge document"
                        className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-transparent px-3 py-2 text-sm leading-relaxed text-black dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-pink-500 disabled:opacity-50 disabled:cursor-not-allowed resize-y min-h-[280px] font-mono"
                    />
                    <div className="flex items-center justify-between gap-2 text-xs">
                        <span className={overCap || isEmpty ? "text-red-500 dark:text-red-400" : "text-gray-600 dark:text-gray-300"}>
                            {docText.length.toLocaleString()} / {ARTIST_DOC_MAX_CHARS.toLocaleString()} characters
                        </span>
                        <button
                            type="button"
                            onClick={() => setDocText(doc)}
                            disabled={disabled}
                            className="text-gray-600 dark:text-gray-300 hover:text-pink-500 dark:hover:text-pink-400 underline underline-offset-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                        >
                            Reset to generated
                        </button>
                    </div>
                </div>
            ) : (
                <div className="text-sm text-black dark:text-white space-y-2 max-h-[45vh] overflow-y-auto overscroll-contain scrollbar-glass pr-1">
                    {renderDocBody(docText, sources)}
                </div>
            )}
            {sources.length > 0 && !isEditing && (
                <div className="pt-3 border-t border-black/10 dark:border-white/10 space-y-1">
                    <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">Sources</p>
                    {sources.map(s => (
                        <p key={s.id} className="text-xs text-gray-600 dark:text-gray-300 break-all">
                            [{s.id}]{" "}
                            {s.url ? (
                                <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:text-pink-500 dark:hover:text-pink-400 hover:underline">
                                    {s.label}
                                </a>
                            ) : (
                                <span>{s.label}</span>
                            )}
                        </p>
                    ))}
                </div>
            )}
            {(isEmpty || overCap) && (
                <p className="text-xs text-red-500 dark:text-red-400">
                    {isEmpty
                        ? "Your document can't be empty — add some text before continuing."
                        : `That's over the ${ARTIST_DOC_MAX_CHARS.toLocaleString()}-character limit — trim it down before continuing.`}
                </p>
            )}
            <div className="space-y-2 pt-1">
                <button
                    onClick={() => onChoose({ mode: "generate", doc: docText })}
                    disabled={blocked}
                    className="w-full bg-pink-500 enabled:hover:bg-pink-600 active:bg-pink-700 transition-colors text-white font-semibold py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    This is right — write my About from it
                </button>
                <button
                    onClick={() => onChoose({ mode: "self", doc: docText })}
                    disabled={blocked}
                    className="w-full text-sm py-2 rounded-lg border border-pink-500 text-pink-500 enabled:hover:bg-pink-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    I&apos;ll write my About myself
                </button>
            </div>
        </div>
    );
}

// ---------- About draft: show finished work, ask one yes/no ----------

export function AboutDraftCard({ doc, about, sources = [], startEditing = false, onPublish, disabled }: {
    doc: string;
    about: string;
    sources?: DocSource[];
    /** Open straight into the editor — set when the artist chose to write their
     *  own About, where the card would otherwise present an empty paragraph and
     *  a disabled Publish button with no obvious way in. */
    startEditing?: boolean;
    onPublish: (r: { doc: string; about: string }) => void;
    disabled: boolean;
}) {
    const [isEditing, setIsEditing] = useState(startEditing);
    // Edits live here independent of `isEditing` so toggling the textarea off
    // (without publishing) keeps whatever the artist typed instead of quietly
    // reverting to the generated `about` prop.
    const [aboutText, setAboutText] = useState(about);

    const isEmpty = aboutText.trim().length === 0;
    const overCap = aboutText.length > MAX_BIO_LENGTH;
    const publishDisabled = disabled || isEmpty || overCap;
    // Metered in words against the target the generator writes to, not in characters
    // against MAX_BIO_LENGTH. 10,000 is a hard cap on the column; showing it here read
    // as "you have thousands of characters left" under prose aimed at ~100 words.
    const wordCount = isEmpty ? 0 : aboutText.trim().split(/\s+/).length;
    const overTarget = wordCount > ABOUT_TARGET_WORDS;

    return (
        <div className="glass-subtle rounded-xl p-4 space-y-3 w-full">
            <h3 className="font-bold text-pink-500">Your About</h3>
            {isEditing ? (
                <div className="space-y-1.5">
                    <textarea
                        value={aboutText}
                        onChange={e => setAboutText(e.target.value)}
                        disabled={disabled}
                        rows={14}
                        aria-label="Edit your About"
                        className="w-full rounded-lg border border-black/10 dark:border-white/10 bg-transparent px-3 py-2 text-sm leading-relaxed text-black dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-pink-500 disabled:opacity-50 disabled:cursor-not-allowed resize-y min-h-[220px]"
                    />
                    <div className="flex items-center justify-between gap-2 text-xs">
                        <span className={overCap || isEmpty ? "text-red-500 dark:text-red-400" : overTarget ? "text-amber-600 dark:text-amber-400" : "text-gray-600 dark:text-gray-300"}>
                            {wordCount.toLocaleString()} {wordCount === 1 ? "word" : "words"} — aiming for about {ABOUT_TARGET_WORDS}
                        </span>
                        <button
                            type="button"
                            onClick={() => setAboutText(about)}
                            disabled={disabled}
                            className="text-gray-600 dark:text-gray-300 hover:text-pink-500 dark:hover:text-pink-400 underline underline-offset-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                        >
                            Reset to generated
                        </button>
                    </div>
                </div>
            ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-black dark:text-white">{renderWithCitations(aboutText, sources)}</p>
            )}
            {/* Publish-blocking reason: rendered regardless of edit mode, so
                emptying the text and then leaving edit mode (via Done) doesn't
                leave a disabled button with no visible explanation. */}
            {(isEmpty || overCap) && (
                <p className="text-xs text-red-500 dark:text-red-400">
                    {isEmpty
                        ? "Your About can't be empty — add some text before publishing."
                        : `That's over the ${MAX_BIO_LENGTH.toLocaleString()}-character limit — trim it down before publishing.`}
                </p>
            )}
            {/* Bottom action row: Edit/Done stays reachable right beside the
                publish decision, instead of scrolling off-screen above a long
                About (the affordance is otherwise invisible at the moment the
                artist is deciding whether to publish). Edit is the clearly
                secondary (outline) action; Publish this stays primary. */}
            <div className="flex items-stretch gap-2">
                <button
                    type="button"
                    onClick={() => setIsEditing(prev => !prev)}
                    disabled={disabled}
                    className="flex-none text-sm px-3 py-2.5 rounded-lg border border-pink-500 text-pink-500 enabled:hover:bg-pink-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    {isEditing ? "Done" : "Edit"}
                </button>
                <button
                    onClick={() => onPublish({ doc, about: aboutText })}
                    disabled={publishDisabled}
                    className="flex-1 bg-pink-500 enabled:hover:bg-pink-600 active:bg-pink-700 transition-colors text-white font-semibold py-2.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Publish this
                </button>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-300">
                This also saves your artist doc — it powers your page&apos;s Q&amp;A and fun facts.
            </p>
        </div>
    );
}
