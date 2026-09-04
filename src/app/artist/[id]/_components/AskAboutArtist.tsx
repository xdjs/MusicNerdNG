"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X, CornerDownLeft } from "lucide-react";

interface AskAboutArtistProps {
    artistId: string;
    artistName: string;
}

const DEFAULT_SUGGESTIONS = (name: string) => [
    `How did ${name} get started?`,
    `What's ${name}'s latest project?`,
    `Who has ${name} collaborated with?`,
    `What is ${name} known for?`,
];

type AnswerSource = { n: number; title: string; url: string };
type AnswerMention = { name: string; artistId?: string; instagram?: string; role?: string };
type AnswerSong = { title: string; spotifyUrl: string; kind?: string };
type TrackLink = { service: string; url: string };

/** A pill has room for where it ran, not for a headline. The full title is the
 *  hover.
 *
 *  Except when every source is the same site. An answer about what an artist has
 *  been doing lately cites a dozen of their own posts, and twelve pills reading
 *  "instagram.com" tell a reader nothing and look like a bug. The titles carry
 *  the date — "Pete Rango on Instagram, 2026-03-23" — so the pill shows that
 *  instead, and the reader can see which one is the recent one. */
function sourceHost(s: AnswerSource): string {
    // The artist answering a question we asked. There is no page to send
    // anyone to, and saying so beats showing a truncated question.
    if (!s.url) return "their own words";
    const dated = s.title.match(/\b(\d{4})-(\d{2})-\d{2}\b/);
    let host: string;
    try { host = new URL(s.url).hostname.replace(/^www\./, ""); }
    catch { return s.title.slice(0, 32); }
    if (!dated) return host;
    const month = MONTHS[Number(dated[2]) - 1];
    return month ? `${host} · ${month} ${dated[1]}` : host;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];


/**
 * Render an answer: its people, its records, and its citations.
 *
 * ONE PASS, NOT THREE. Mentions, song titles and citation markers all want to
 * replace spans of the same string, and running them in sequence means the
 * second pass matches inside what the first produced — a citation marker inside
 * a linked title, a name inside a bracket. So every candidate span is collected
 * with its position, overlaps are resolved by taking the earliest, and the text
 * is emitted once.
 *
 * WHO IS LINKABLE IS THE SERVER'S DECISION and this only renders it. That split
 * matters: the resolver returns credited collaborators and artists whose name
 * identifies exactly one person in the directory — never a name lifted out of a
 * story, because linking someone who died to whoever holds a matching handle is
 * a mistake you only make once.
 */
function renderAnswer(
    text: string,
    mentions: AnswerMention[],
    songs: AnswerSong[],
    sources: AnswerSource[],
    bandcamp: string | null,
    artistName: string,
): React.ReactNode {
    type Span = { start: number; end: number; node: (key: string) => React.ReactNode };
    const spans: Span[] = [];
    const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const byNumber = new Map(sources.map(s => [s.n, s]));

    // CITATIONS. The model writes "[4]", "[11, 18, Artist Doc]" and sometimes
    // "[2026-05-13]". Only the numbers are citations, and only numbers we have a
    // source for are links.
    //
    // "[Artist Doc]" is the label on the one context block handed to the model
    // unnumbered, so it invents that marker for anything it read there. There is
    // no source behind it and never can be — the document has no public URL — so
    // it is dropped rather than shown. A reader was seeing an internal variable
    // name in the middle of a sentence.
    for (const m of text.matchAll(/\[([^\]]{1,60})\]/g)) {
        const body = m[1];
        if (/\d{4}-\d{2}/.test(body)) continue;                     // a date, not a citation
        const nums = body.split(",").map(p => Number(p.trim())).filter(n => Number.isInteger(n) && n > 0);
        const cited = nums.map(n => byNumber.get(n)).filter((x): x is AnswerSource => !!x);
        // A bracket with nothing citable in it disappears entirely, which covers
        // "[Artist Doc]" and a number for a source the answer did not end up
        // carrying.
        const at = m.index ?? 0;
        spans.push({
            start: at,
            end: at + m[0].length,
            node: key => cited.length === 0 ? null : (
                <sup key={key} className="ml-0.5 text-[0.65em] font-medium">
                    {cited.map((c, i) => (
                        <span key={c.n}>
                            {i > 0 && <span className="text-muted-foreground/50">,</span>}
                            {c.url ? (
                                <a
                                    href={c.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={c.title}
                                    className="px-[0.15em] text-pastypink hover:underline"
                                >
                                    {c.n}
                                </a>
                            ) : (
                                // The artist told us this directly. Nowhere to
                                // link to, and a link that goes nowhere is
                                // worse than a number that admits it.
                                <span title={c.title} className="px-[0.15em] text-pastypink">
                                    {c.n}
                                </span>
                            )}
                        </span>
                    ))}
                </sup>
            ),
        });
    }

    // RECORDS. Matched on the title the server proved is theirs, on word
    // boundaries and allowing whatever punctuation the writer used between the
    // words — the same rule the server applies, so the two cannot disagree
    // about which spans are records. Without the boundaries a catalogue
    // containing "rush" turned the "rush" inside "rushing" into a button.
    for (const song of songs) {
        // Unicode-aware and identical to the server's rule, so the two cannot
        // disagree about which spans are records. \b is ASCII-only, so the
        // edges are asserted as "not a letter or digit" instead.
        const tokens = song.title.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
        if (tokens.length === 0) continue;
        const re = new RegExp(
            `(?<![\\p{L}\\p{N}])${tokens.map(escape).join("[^\\p{L}\\p{N}]+")}(?![\\p{L}\\p{N}])`,
            "giu",
        );
        for (const m of text.matchAll(re)) {
            const at = m.index ?? 0;
            spans.push({
                start: at,
                end: at + m[0].length,
                node: key => (
                    <SongLink key={key} label={m[0]} song={song} artistName={artistName} bandcamp={bandcamp} />
                ),
            });
        }
    }

    // PEOPLE. Longest first so "Dame Atlas" wins over "Dame".
    const ordered = [...mentions].sort((a, b) => b.name.length - a.name.length);
    for (const person of ordered) {
        const href = person.artistId
            ? `/artist/${person.artistId}`
            : person.instagram ? `https://www.instagram.com/${person.instagram}/` : null;
        if (!href) continue;
        // \b is ASCII-only: "Beyoncé\b" asserts a boundary after é, which is not
        // a word character to \b, so the name never matched and the person went
        // unlinked. Asserted as "not followed by a letter or digit" instead,
        // which is the same rule the record matcher uses.
        const re = new RegExp(`@?${escape(person.name)}(?![\\p{L}\\p{N}])`, "giu");
        for (const m of text.matchAll(re)) {
            const at = m.index ?? 0;
            spans.push({
                start: at,
                end: at + m[0].length,
                node: key => (
                    <a
                        key={key}
                        href={href}
                        {...(person.artistId ? {} : { target: "_blank", rel: "noopener noreferrer" })}
                        className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
                        title={person.role ? `${person.name} — ${person.role}` : person.name}
                    >
                        {m[0]}
                    </a>
                ),
            });
        }
    }

    if (spans.length === 0) return text;

    // Earliest wins, and anything overlapping it is dropped — a name inside a
    // record's title is the title, not a second link.
    spans.sort((a, b) => a.start - b.start || b.end - a.end);
    const out: React.ReactNode[] = [];
    let cursor = 0;
    let key = 0;
    for (const span of spans) {
        if (span.start < cursor) continue;
        if (span.start > cursor) out.push(text.slice(cursor, span.start));
        out.push(span.node(`s${key++}`));
        cursor = span.end;
    }
    if (cursor < text.length) out.push(text.slice(cursor));
    return out;
}

/**
 * The same icons the Links row on this page uses, so the menu reads as part of
 * the profile rather than a stray dropdown.
 *
 * Apple Music has no icon in `public/siteIcons`, and adding a platform logo is
 * an asset decision rather than a styling one — so a service without an icon
 * gets a lettered chip in the same circle. It looks deliberate next to the
 * others instead of leaving a hole.
 */
const SERVICE_ICON: Record<string, string> = {
    Spotify: "/siteIcons/spotify_icon.svg",
    Deezer: "/siteIcons/deezer_icon.svg",
    Bandcamp: "/siteIcons/bandcamp_icon.svg",
};

function ServiceIcon({ service }: { service: string }) {
    // "Bandcamp (artist page)" carries its caveat in the label; the icon lookup
    // wants the bare name.
    const src = SERVICE_ICON[service.split(" (")[0]];
    return (
        <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-white/40 bg-white/70 shadow-sm transition-all duration-200 group-hover/opt:scale-110 group-hover/opt:bg-white/90 dark:border-white/15 dark:bg-white/10 dark:group-hover/opt:bg-white/20">
            {src
                ? <img src={src} alt="" aria-hidden className="h-6 w-6 object-contain" />
                : <span className="text-sm font-semibold text-black/70 dark:text-white/70">{service.slice(0, 1)}</span>}
        </span>
    );
}

/**
 * A record, and everywhere you can hear it.
 *
 * Opens on click rather than resolving up front: two provider lookups per song,
 * on an answer naming three of them, is most of a second added to every question
 * for links most readers never open.
 *
 * Spotify is always there, because that is where the title was proved to be
 * this artist's in the first place. Apple Music and Deezer are searched live.
 * Bandcamp is offered as the ARTIST's page and labelled as such — they have no
 * API, so we genuinely do not know whether this particular record is on it, and
 * a "buy this song" link that lands on a different one is worse than an honest
 * one that lands on their store.
 */
function SongLink({
    label, song, artistName, bandcamp,
}: {
    label: string;
    song: AnswerSong;
    artistName: string;
    bandcamp: string | null;
}) {
    const [open, setOpen] = useState(false);
    const [links, setLinks] = useState<TrackLink[] | null>(null);
    const [loading, setLoading] = useState(false);
    const box = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        if (!open) return;
        const away = (e: MouseEvent) => {
            if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
        };
        const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
        document.addEventListener("mousedown", away);
        document.addEventListener("keydown", esc);
        return () => {
            document.removeEventListener("mousedown", away);
            document.removeEventListener("keydown", esc);
        };
    }, [open]);

    const toggle = async () => {
        const next = !open;
        setOpen(next);
        if (!next || links !== null || loading) return;
        setLoading(true);
        try {
            const q = new URLSearchParams({
                title: song.title,
                artist: artistName,
                // Albums and singles need different provider endpoints.
                kind: song.kind ?? "album",
            });
            const res = await fetch(`/api/trackLinks?${q}`);
            const data = await res.json();
            setLinks(Array.isArray(data.links) ? data.links : []);
        } catch {
            // An empty list, not an error state: Spotify is already on the menu
            // and a failed lookup should not take a working link away.
            setLinks([]);
        } finally {
            setLoading(false);
        }
    };

    const options: TrackLink[] = [
        { service: "Spotify", url: song.spotifyUrl },
        ...(links ?? []),
        ...(bandcamp ? [{ service: "Bandcamp (artist page)", url: bandcamp }] : []),
    ];

    return (
        <span className="relative inline-block" ref={box}>
            <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                className="underline decoration-dotted underline-offset-2 hover:decoration-solid text-left"
                title={`Where to hear ${song.title}`}
            >
                {label}
            </button>
            {open && (
                <span
                    role="dialog"
                    aria-label={`Where to hear ${song.title}`}
                    className="glass absolute left-0 top-full z-30 mt-2 flex w-max max-w-[min(20rem,80vw)] flex-col gap-2 rounded-xl border border-black/10 p-3 shadow-xl dark:border-white/15"
                >
                    <span className="max-w-[16rem] truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        Where to hear “{song.title}”
                    </span>
                    <span className="flex flex-wrap items-start gap-3">
                        {options.map(o => (
                            <a
                                key={o.service}
                                href={o.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group/opt flex w-16 flex-col items-center gap-1.5 no-underline"
                            >
                                <ServiceIcon service={o.service} />
                                {/* THE CAVEAT SURVIVES THE REDESIGN. "Bandcamp
                                    (artist page)" says it is their store and not
                                    this record, because Bandcamp has no API and
                                    we cannot claim more. Truncating that to
                                    "Bandcamp" under an icon would quietly turn an
                                    honest link into a false one, so the
                                    parenthetical becomes a second line rather
                                    than disappearing. */}
                                <span className="w-full text-center text-[11px] leading-tight text-muted-foreground">
                                    {o.service.split(" (")[0]}
                                    {o.service.includes(" (") && (
                                        <span className="block text-[10px] leading-tight text-muted-foreground/70">
                                            {o.service.slice(o.service.indexOf("(") + 1, -1)}
                                        </span>
                                    )}
                                </span>
                            </a>
                        ))}
                        {/* Same footprint as an option, so the row does not jump
                            when the lookup lands — the old menu grew a text line
                            underneath and shifted everything already rendered. */}
                        {loading && (
                            <span className="flex w-16 flex-col items-center gap-1.5" aria-live="polite">
                                <span className="h-10 w-10 animate-pulse rounded-full border border-white/40 bg-white/40 dark:border-white/15 dark:bg-white/10" />
                                <span className="w-full truncate text-center text-[11px] leading-tight text-muted-foreground">
                                    Looking…
                                </span>
                            </span>
                        )}
                    </span>
                    {!loading && links?.length === 0 && options.length === 1 && (
                        <span className="text-[11px] text-muted-foreground">Nowhere else we could find it.</span>
                    )}
                </span>
            )}
        </span>
    );
}

export default function AskAboutArtist({ artistId, artistName }: AskAboutArtistProps) {
    const [question, setQuestion] = useState("");
    const [answer, setAnswer] = useState<string | null>(null);
    const [askedQuestion, setAskedQuestion] = useState<string | null>(null);
    const [suggestions, setSuggestions] = useState<string[]>(DEFAULT_SUGGESTIONS(artistName));
    const [sources, setSources] = useState<AnswerSource[]>([]);
    const [mentions, setMentions] = useState<AnswerMention[]>([]);
    const [songs, setSongs] = useState<AnswerSong[]>([]);
    /** The artist's own Bandcamp, offered under a record as their store rather
     *  than as that record — Bandcamp has no API, so we cannot claim more. */
    const [bandcamp, setBandcamp] = useState<string | null>(null);
    /** The endpoint answered from the open web because our own sources did not
     *  cover the question, and these are the domains it used. Without this the
     *  reader could not tell a researched answer from a searched one — which is
     *  the whole reason the fallback reports it. */
    const [fromOpenWeb, setFromOpenWeb] = useState(false);
    const [webDomains, setWebDomains] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const askedQuestions = useRef<Set<string>>(new Set());
    const inputRef = useRef<HTMLInputElement>(null);

    const ask = async (q: string) => {
        const trimmed = q.trim();
        if (!trimmed || loading) return;

        setLoading(true);
        setError(null);
        setAnswer(null);
        // Cleared with the answer, not left over it: a failed second question
        // would otherwise still be captioned with the first one's provenance.
        setFromOpenWeb(false);
        setWebDomains([]);
        setSongs([]);
        setAskedQuestion(trimmed);
        setQuestion("");
        askedQuestions.current.add(trimmed.toLowerCase());

        try {
            const res = await fetch("/api/askArtist", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ artistId, question: trimmed }),
            });
            const data = await res.json();

            if (!res.ok || data.error) {
                setError(data.error ?? "Something went wrong");
                return;
            }

            setAnswer(data.answer);
            setSources(Array.isArray(data.sources) ? data.sources : []);
            setSongs(Array.isArray(data.songs) ? data.songs : []);
            setBandcamp(typeof data.bandcamp === "string" ? data.bandcamp : null);
            setFromOpenWeb(data.fromOpenWeb === true);
            setWebDomains(Array.isArray(data.webDomains) ? data.webDomains : []);
            setMentions(Array.isArray(data.mentions) ? data.mentions : []);
            if (data.suggestions?.length) {
                // Filter out any suggestions the user has already asked
                const fresh = data.suggestions.filter(
                    (s: string) => !askedQuestions.current.has(s.toLowerCase())
                );
                setSuggestions(fresh.length > 0 ? fresh : data.suggestions);
            }
        } catch {
            setError("Failed to get an answer. Try again.");
        } finally {
            setLoading(false);
        }
    };

    const reset = () => {
        setAnswer(null);
        setAskedQuestion(null);
        setError(null);
        // Keep current suggestions instead of reverting to defaults
        setTimeout(() => inputRef.current?.focus(), 50);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        ask(question);
    };

    return (
        <div className="space-y-3">
            {/* Input */}
            <form onSubmit={handleSubmit} className="relative">
                <input
                    ref={inputRef}
                    type="text"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder={`Ask anything about ${artistName}...`}
                    maxLength={500}
                    disabled={loading}
                    className="w-full glass-subtle pl-10 pr-10 py-3 rounded-xl text-sm text-black dark:text-white placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-pastypink/40 transition-shadow"
                />
                <Search
                    size={16}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/50"
                />
                {question.trim() && !loading && (
                    <button
                        type="submit"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-pastypink hover:text-pastypink/80 transition-colors"
                        aria-label="Submit question"
                    >
                        <CornerDownLeft size={16} />
                    </button>
                )}
            </form>

            {/* Answer area */}
            {(loading || answer || error) && (
                <div className="glass-subtle rounded-xl p-4 space-y-3 relative">
                    {/* Close button */}
                    {!loading && (
                        <button
                            onClick={reset}
                            className="absolute top-3 right-3 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-white hover:bg-pastypink/80 transition-colors"
                            aria-label="Close answer"
                        >
                            <X size={14} />
                        </button>
                    )}

                    {/* Question echo */}
                    {askedQuestion && (
                        <p className="text-xs text-muted-foreground/70 pr-8">
                            <span className="font-semibold text-pastypink">Q:</span> {askedQuestion}
                        </p>
                    )}

                    {/* Loading */}
                    {loading && (
                        <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                            <img src="/music_nerd_logo_sm.png" alt="Loading" className="h-7 animate-pulse" />
                            <span>Thinking...</span>
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <p className="text-sm text-red-400">{error}</p>
                    )}

                    {/* Answer */}
                    {answer && (
                        <p data-testid="answer" className="text-sm text-black dark:text-white leading-relaxed whitespace-pre-line pr-6">
                            {renderAnswer(answer, mentions, songs, sources, bandcamp, artistName)}
                        </p>
                    )}

                    {/* Where it came from.
                      *
                      * "AI-generated response" tells a reader the least useful
                      * true thing about an answer: how it was phrased, not
                      * whether to believe it. The endpoint already reads the
                      * artist's verified vault and their knowledge document as
                      * ground truth, and it collected the source urls and then
                      * dropped them one line before responding. Showing them is
                      * the difference between a chatbot and a researched answer,
                      * and it is what a reader needs in order to trust either. */}
                    {answer && sources.length > 0 && (
                        <div className="flex flex-col gap-1 pt-1">
                            <p className="text-[10px] text-muted-foreground/60">Sources</p>
                            <div className="flex flex-wrap gap-1.5">
                                {sources.map(s => {
                                    const label = (
                                        <>
                                            <span className="opacity-50">[{s.n}]</span>
                                            {sourceHost(s)}
                                        </>
                                    );
                                    const pill = "inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-black/10 dark:border-white/15 text-gray-600 dark:text-gray-400 whitespace-nowrap max-w-[16rem] truncate";
                                    return s.url ? (
                                        <a
                                            key={s.n}
                                            href={s.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={`${pill} hover:border-black/25 dark:hover:border-white/30`}
                                            title={s.title}
                                        >
                                            {label}
                                        </a>
                                    ) : (
                                        <span key={s.n} className={pill} title={s.title}>{label}</span>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Answered from the open web, because our own sources did
                      * not cover it. Named as such: a reader has to be able to
                      * tell "this is from the artist's own posts and their
                      * vault" from "this is from a search". */}
                    {answer && fromOpenWeb && (
                        <div className="flex flex-col gap-1 pt-1">
                            <p className="text-[10px] text-muted-foreground/60">
                                Not in {artistName}&apos;s sources — answered from the web
                            </p>
                            {webDomains.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {webDomains.map(d => (
                                        <span
                                            key={d}
                                            className="inline-flex items-center text-[10px] px-2 py-0.5 rounded-full border border-dashed border-black/15 dark:border-white/20 text-gray-600 dark:text-gray-400 whitespace-nowrap"
                                        >
                                            {d}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {answer && (
                        <p className="text-[10px] text-muted-foreground/40 italic">
                            {sources.length > 0
                                ? "Written by AI from the sources above"
                                : fromOpenWeb
                                    ? "Written by AI from a web search"
                                    : "AI-generated response"}
                        </p>
                    )}
                </div>
            )}

            {/* Suggestion chips */}
            {!loading && (
                <div className="flex flex-wrap gap-2">
                    {suggestions.map((suggestion) => (
                        <button
                            key={suggestion}
                            onClick={() => ask(suggestion)}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium glass-subtle text-muted-foreground hover:text-black dark:hover:text-white hover:scale-[1.03] transition-all duration-150 border border-transparent hover:border-pastypink/30"
                        >
                            {suggestion}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
