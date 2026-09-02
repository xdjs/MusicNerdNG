"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { ProfileCandidate } from "./StepCards";

/**
 * Two accounts, one platform, and only the artist knows which.
 *
 * The auto-build cannot stop to ask — nobody is watching it — so it writes the
 * best-evidenced account and sends the alternative here. That is the whole
 * reason this is a separate card rather than part of the profiles step: by the
 * time there is somebody to ask, the link is already made.
 *
 * BEFORE THIS, THE ALTERNATIVE WAS DISCARDED IN THREE PLACES — discovery's
 * dedupe kept one per platform, the client's live feed merged on platform, and
 * the profiles card hid multi-candidate platforms and reported them as "still
 * missing". Black Dave MK2 runs two real Instagram accounts and confirmed both
 * are his; we found one, silently dropped the other, and told him we had found
 * nothing.
 *
 * ONE HANDLE STILL WINS. `artists.instagram` is a single column, so this is a
 * choice, not a multi-select — the artist swaps which account is linked, and
 * the other is let go. Presenting it as anything else would promise storage
 * that does not exist.
 *
 * Writes through /api/directEditLink, the same authorized endpoint the profile
 * page's own link editor uses (`canEditArtist`), rather than a new turn type:
 * the onboarding steps are already confirmed by the time this appears, and a
 * turn would try to advance a flow that has finished.
 */
export default function ProfileChoice({
    artistId,
    platform,
    chosen,
    options,
}: {
    artistId: string;
    platform: string;
    chosen: string;
    options: ProfileCandidate[];
}) {
    const [linked, setLinked] = useState(chosen);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const label = options[0]?.displayName || platform;

    const choose = async (candidate: ProfileCandidate) => {
        if (busy || candidate.value === linked) return;
        setBusy(candidate.value);
        setError(null);
        try {
            const res = await fetch("/api/directEditLink", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ artistId, action: "set", url: candidate.profileUrl }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                setError(body.error ?? "Couldn't switch that over.");
                return;
            }
            setLinked(candidate.value);
        } catch {
            setError("Couldn't switch that over.");
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="glass-subtle self-start w-full rounded-xl p-4 space-y-2.5">
            <p className="text-sm font-semibold text-black dark:text-white">
                Two {label} accounts look like yours
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-300">
                We linked the first one. If the other is the one you use, switch it — we can only show one.
            </p>
            <div className="space-y-2">
                {options.map(option => {
                    const isLinked = option.value === linked;
                    return (
                        <div
                            key={`${option.siteName}:${option.value}`}
                            className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 ${
                                isLinked
                                    ? "border-green-500/50 bg-green-500/10"
                                    : "border-dashed border-black/15 dark:border-white/15"
                            }`}
                        >
                            <a
                                href={option.profileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="min-w-0 text-sm text-black dark:text-white hover:underline truncate"
                            >
                                @{option.value}
                            </a>
                            <button
                                type="button"
                                disabled={isLinked || busy !== null}
                                onClick={() => void choose(option)}
                                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                                    isLinked
                                        ? "text-green-700 dark:text-green-400"
                                        : "bg-pastypink text-black disabled:opacity-40"
                                }`}
                            >
                                {busy === option.value
                                    ? <Loader2 size={12} className="animate-spin" />
                                    : isLinked ? "Linked ✓" : "This one"}
                            </button>
                        </div>
                    );
                })}
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
    );
}
