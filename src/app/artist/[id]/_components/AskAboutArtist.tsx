"use client";

import { useState, useRef } from "react";
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

/** A pill has room for where it ran, not for a headline. The full title is the
 *  hover. */
function sourceHost(s: AnswerSource): string {
    try { return new URL(s.url).hostname.replace(/^www\./, ""); }
    catch { return s.title.slice(0, 32); }
}


/**
 * Turn credited collaborators named in an answer into links.
 *
 * The server decides WHO is linkable and this only renders it. That split
 * matters: the resolver returns credited collaborators only, never people named
 * in the artist's statements, because those include people talked about rather
 * than worked with — and linking a name out of a story about someone who died
 * to whoever holds a matching handle is a mistake you only make once.
 *
 * A collaborator already in the directory goes to their profile; one who is not
 * goes to their Instagram, which is also a quiet list of people who ought to be
 * here.
 */
function linkifyMentions(text: string, mentions: AnswerMention[]): React.ReactNode {
    if (mentions.length === 0) return text;

    // Longest first, so "@dame atlas" wins over "@dame" where both are credited.
    const ordered = [...mentions].sort((a, b) => b.name.length - a.name.length);
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`@?(${ordered.map(m => escape(m.name)).join("|")})\\b`, "gi");

    const out: React.ReactNode[] = [];
    let last = 0;
    let match: RegExpExecArray | null;
    let key = 0;
    while ((match = pattern.exec(text)) !== null) {
        const found = ordered.find(m => m.name.toLowerCase() === match![1].toLowerCase());
        if (!found) continue;
        const href = found.artistId
            ? `/artist/${found.artistId}`
            : found.instagram ? `https://www.instagram.com/${found.instagram}/` : null;
        if (!href) continue;

        if (match.index > last) out.push(text.slice(last, match.index));
        out.push(
            <a
                key={`m${key++}`}
                href={href}
                {...(found.artistId ? {} : { target: "_blank", rel: "noopener noreferrer" })}
                className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
                title={found.role ? `${found.name} — ${found.role}` : found.name}
            >
                {match[0]}
            </a>,
        );
        last = match.index + match[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out.length > 0 ? out : text;
}

export default function AskAboutArtist({ artistId, artistName }: AskAboutArtistProps) {
    const [question, setQuestion] = useState("");
    const [answer, setAnswer] = useState<string | null>(null);
    const [askedQuestion, setAskedQuestion] = useState<string | null>(null);
    const [suggestions, setSuggestions] = useState<string[]>(DEFAULT_SUGGESTIONS(artistName));
    const [sources, setSources] = useState<AnswerSource[]>([]);
    const [mentions, setMentions] = useState<AnswerMention[]>([]);
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
                        <p className="text-sm text-black dark:text-white leading-relaxed whitespace-pre-line pr-6">
                            {linkifyMentions(answer, mentions)}
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
                                {sources.map(s => (
                                    <a
                                        key={s.n}
                                        href={s.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-black/10 dark:border-white/15 text-gray-600 dark:text-gray-400 hover:border-black/25 dark:hover:border-white/30 whitespace-nowrap max-w-[16rem] truncate"
                                        title={s.title}
                                    >
                                        <span className="opacity-50">[{s.n}]</span>
                                        {sourceHost(s)}
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}

                    {answer && (
                        <p className="text-[10px] text-muted-foreground/40 italic">
                            {sources.length > 0
                                ? "Written by AI from the sources above"
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
