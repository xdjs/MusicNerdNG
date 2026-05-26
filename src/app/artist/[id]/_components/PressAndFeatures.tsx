"use client";

import { useState, useRef, useMemo } from "react";
import { SOURCE_TYPE_COLORS, type SourceType } from "@/lib/sourceTypes";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface VaultSource {
    id: string;
    url: string;
    title?: string | null;
    snippet?: string | null;
    type?: string | null;
    ogImage?: string | null;
}

interface PressAndFeaturesProps {
    sources: VaultSource[];
}

function getSourceDomain(url: string): string {
    try {
        return new URL(url).hostname.replace("www.", "");
    } catch {
        return url;
    }
}

// Privacy note: Google favicon service sees which domains are rendered.
// Consider self-hosted proxy if this becomes a concern.
function getFaviconUrl(url: string): string {
    try {
        const domain = new URL(url).hostname;
        return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    } catch {
        return "";
    }
}

const TYPE_LABELS: Record<string, string> = {
    article: "Article",
    interview: "Interview",
    review: "Review",
    profile: "Profile",
    news: "News",
    video: "Video",
    audio: "Audio",
    social: "Social",
    document: "Document",
    image: "Image",
    data: "Data",
};

function SourceCard({ source }: { source: VaultSource }) {
    const type = (source.type ?? "article") as SourceType;
    const colors = SOURCE_TYPE_COLORS[type] ?? SOURCE_TYPE_COLORS.article;
    const domain = getSourceDomain(source.url);
    const favicon = getFaviconUrl(source.url);
    const hasImage = !!source.ogImage;

    return (
        <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex-shrink-0 w-[260px] sm:w-[320px] h-[300px] sm:h-[320px] glass-subtle overflow-hidden flex flex-col transition-all duration-300 hover:shadow-[0_0_30px_rgba(239,149,255,0.35)]"
        >
            {/* Thumbnail — fixed height, gradient always behind as fallback */}
            <div className="relative w-full h-[160px] sm:h-[180px] shrink-0 overflow-hidden bg-gradient-to-br from-pastypink/10 via-purple-900/20 to-transparent">
                {/* Favicon centered as fallback (visible when no image or image fails) */}
                {favicon && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={favicon}
                            alt=""
                            className="w-10 h-10 rounded-lg opacity-50"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                    </div>
                )}
                {/* OG image on top — hides favicon when loaded */}
                {hasImage && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={source.ogImage!}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                )}

                {/* Type badge */}
                <span
                    className={`absolute top-3 left-3 inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide backdrop-blur-md ${colors.bg} ${colors.text} ${colors.border} border`}
                >
                    {TYPE_LABELS[type] ?? "Article"}
                </span>
            </div>

            {/* Content — fills remaining space */}
            <div className="p-4 flex flex-col flex-1 min-h-0">
                <h3 className="text-sm font-semibold text-black dark:text-white leading-snug line-clamp-2">
                    {source.title ?? "Untitled"}
                </h3>

                <div className="flex items-center gap-1.5 mt-auto pt-2">
                    {favicon && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={favicon}
                            alt=""
                            className="w-4 h-4 rounded-sm shrink-0"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                    )}
                    <span className="text-[11px] text-muted-foreground/60 truncate">
                        {domain}
                    </span>
                </div>
            </div>
        </a>
    );
}

export default function PressAndFeatures({ sources }: PressAndFeaturesProps) {
    const [activeFilter, setActiveFilter] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Build type counts + filtered list (memoized) — must be before early return
    const { types, filtered } = useMemo(() => {
        const counts: Record<string, number> = {};
        const items: typeof sources = [];
        for (const s of sources) {
            const t = s.type ?? "article";
            counts[t] = (counts[t] ?? 0) + 1;
            if (!activeFilter || t === activeFilter) items.push(s);
        }
        return {
            types: Object.entries(counts).sort((a, b) => b[1] - a[1]),
            filtered: items,
        };
    }, [sources, activeFilter]);

    const scroll = (direction: "left" | "right") => {
        if (!scrollRef.current) return;
        // Use first card's width + gap for scroll amount, fallback to container width
        const firstCard = scrollRef.current.querySelector<HTMLElement>("[data-vault-card]");
        const amount = firstCard ? firstCard.offsetWidth + 16 : scrollRef.current.clientWidth;
        scrollRef.current.scrollBy({
            left: direction === "left" ? -amount : amount,
            behavior: "smooth",
        });
    };

    if (sources.length === 0) return null;

    return (
        <div className="space-y-3">
            {/* Filter chips */}
            {types.length > 1 && (
                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={() => setActiveFilter(null)}
                        aria-pressed={activeFilter === null}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                            activeFilter === null
                                ? "bg-pastypink text-white"
                                : "glass-subtle text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        All ({sources.length})
                    </button>
                    {types.map(([type, count]) => {
                        const colors = SOURCE_TYPE_COLORS[type as SourceType] ?? SOURCE_TYPE_COLORS.article;
                        return (
                            <button
                                key={type}
                                onClick={() => setActiveFilter(activeFilter === type ? null : type)}
                                aria-pressed={activeFilter === type}
                                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                                    activeFilter === type
                                        ? `${colors.bg} ${colors.text}`
                                        : "glass-subtle text-muted-foreground hover:text-foreground"
                                }`}
                            >
                                {TYPE_LABELS[type] ?? type} ({count})
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Carousel */}
            <div className="relative group/carousel">
                {/* Left arrow — hidden on touch devices where native scroll suffices */}
                <button
                    onClick={() => scroll("left")}
                    className="hidden sm:flex absolute -left-3 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-black/60 backdrop-blur-md items-center justify-center text-white opacity-0 group-hover/carousel:opacity-100 transition-opacity hover:bg-black/80 shadow-lg"
                    aria-label="Scroll left"
                >
                    <ChevronLeft size={18} />
                </button>

                {/* Scrollable container — extra padding for hover scale */}
                <div
                    ref={scrollRef}
                    className="flex gap-4 overflow-x-auto overflow-y-visible py-4 px-2 -mx-2 scrollbar-none snap-x snap-mandatory"
                    style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                >
                    {filtered.map((source) => (
                        <div key={source.id} className="snap-start" data-vault-card>
                            <SourceCard source={source} />
                        </div>
                    ))}
                </div>

                {/* Right arrow — hidden on touch devices where native scroll suffices */}
                <button
                    onClick={() => scroll("right")}
                    className="hidden sm:flex absolute -right-3 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-black/60 backdrop-blur-md items-center justify-center text-white opacity-0 group-hover/carousel:opacity-100 transition-opacity hover:bg-black/80 shadow-lg"
                    aria-label="Scroll right"
                >
                    <ChevronRight size={18} />
                </button>
            </div>
        </div>
    );
}
