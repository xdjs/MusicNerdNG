"use client";

import { useState } from "react";
import { MAX_BIO_LENGTH } from "@/lib/bioConstants";

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

type ProfilesPayload = {
    artistName: string;
    links: ProfileLink[];
    enrichment: { platform: string; followerCount: number | null; imageUrl: string | null } | null;
};

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

export function ProfilesCard({ payload, onConfirm, disabled }: {
    payload: ProfilesPayload;
    onConfirm: (r: { addedLinks: { url: string }[]; removedSiteNames: string[] }) => void;
    disabled: boolean;
}) {
    const [removed, setRemoved] = useState<Set<string>>(new Set());
    const [added, setAdded] = useState<string[]>([]);
    const [draft, setDraft] = useState("");

    const toggleRemoved = (siteName: string) => {
        setRemoved(prev => {
            const next = new Set(prev);
            if (next.has(siteName)) next.delete(siteName); else next.add(siteName);
            return next;
        });
    };

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
            {isEmpty && added.length === 0 && (
                <div className="text-sm text-gray-600 dark:text-gray-300 px-1 py-2">
                    No profiles linked yet — paste one below whenever you&apos;re ready.
                </div>
            )}
            {added.map(url => (
                <div key={url} className="text-sm text-green-600 dark:text-green-400 px-3">+ {url}</div>
            ))}
            <div className="flex gap-2 pt-1">
                <input
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    placeholder="Paste a link we missed…"
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
                onClick={() => onConfirm({ addedLinks: added.map(url => ({ url })), removedSiteNames: [...removed] })}
                disabled={disabled}
                className="w-full bg-pink-500 enabled:hover:bg-pink-600 active:bg-pink-700 transition-colors text-white font-semibold py-2.5 rounded-lg mt-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {isEmpty ? "Continue" : "Looks good, continue"}
            </button>
        </div>
    );
}

// ---------- Vault: keep-by-default ----------

type VaultPayload = {
    sources: { id: string; title: string | null; url: string; snippet: string | null; ogImage?: string | null }[];
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
                                    <p className="font-medium truncate text-black dark:text-white">{s.title ?? s.url}</p>
                                    {s.snippet && <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">{s.snippet}</p>}
                                    {domain && <p className="text-xs text-gray-600 dark:text-gray-300 truncate">{domain}</p>}
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
                    placeholder="Paste a link — press, an interview, your site…"
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

type InterviewPayload = { questionKey: string; question: string; number: number; total: number };

export function InterviewInput({ payload, onAnswer, disabled }: {
    payload: InterviewPayload;
    onAnswer: (r: { questionKey: string; answer: string | null }) => void;
    disabled: boolean;
}) {
    const [draft, setDraft] = useState("");
    return (
        <div className="w-full space-y-2">
            <p className="text-xs text-gray-700 dark:text-gray-300">Question {payload.number} of {payload.total} — all optional</p>
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

// ---------- About draft: show finished work, ask one yes/no ----------

export function AboutDraftCard({ doc, about, onPublish, disabled }: {
    doc: string;
    about: string;
    onPublish: (r: { doc: string; about: string }) => void;
    disabled: boolean;
}) {
    const [isEditing, setIsEditing] = useState(false);
    // Edits live here independent of `isEditing` so toggling the textarea off
    // (without publishing) keeps whatever the artist typed instead of quietly
    // reverting to the generated `about` prop.
    const [aboutText, setAboutText] = useState(about);

    const isEmpty = aboutText.trim().length === 0;
    const overCap = aboutText.length > MAX_BIO_LENGTH;
    const publishDisabled = disabled || isEmpty || overCap;

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
                        <span className={overCap || isEmpty ? "text-red-500 dark:text-red-400" : "text-gray-600 dark:text-gray-300"}>
                            {aboutText.length.toLocaleString()} / {MAX_BIO_LENGTH.toLocaleString()} characters
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
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-black dark:text-white">{aboutText}</p>
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
