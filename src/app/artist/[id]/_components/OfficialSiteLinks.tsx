interface VaultSourceLike {
    id: string;
    url: string;
    title?: string | null;
    type?: string | null;
}

interface OfficialSiteLinksProps {
    /** Approved vault sources for the artist. Filtered here rather than by the
     *  caller so every consumer gets the same definition of "official site". */
    sources: VaultSourceLike[];
}

function hostLabel(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return url;
    }
}

/**
 * An artist's own website has no home in `urlmap` — there's no generic website
 * platform, only specific ones (and `linktree`). So it lands in the vault as an
 * approved source of type "website", set by the onboarding confirm_profiles
 * handler when the artist hands us a URL whose page title carries their name.
 *
 * Without this the single most authoritative link an artist has would only be
 * reachable by scrolling to the vault, which is where the 2026-08-20 R&D
 * discussion said it must not be buried. Rendered beside Links instead.
 *
 * Deliberately excluded from PressAndFeatures so it isn't shown twice.
 */
export default function OfficialSiteLinks({ sources }: OfficialSiteLinksProps) {
    const sites = sources.filter((s) => s.type === "website");
    if (sites.length === 0) return null;

    return (
        <div className="flex flex-wrap items-center gap-2">
            {sites.map((site) => (
                <a
                    key={site.id}
                    href={site.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={site.title ?? site.url}
                    className="inline-flex items-center gap-1.5 rounded-full border border-teal-300 bg-teal-100 px-3 py-1 text-sm font-medium text-teal-700 transition-colors hover:bg-teal-200 dark:border-teal-700 dark:bg-teal-900/40 dark:text-teal-300 dark:hover:bg-teal-900/70"
                >
                    <span aria-hidden="true">🌐</span>
                    {hostLabel(site.url)}
                </a>
            ))}
        </div>
    );
}
