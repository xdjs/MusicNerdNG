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

export default function AskAboutArtist({ artistId, artistName }: AskAboutArtistProps) {
    const [question, setQuestion] = useState("");
    const [answer, setAnswer] = useState<string | null>(null);
    const [askedQuestion, setAskedQuestion] = useState<string | null>(null);
    const [suggestions, setSuggestions] = useState<string[]>(DEFAULT_SUGGESTIONS(artistName));
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
                            {answer}
                        </p>
                    )}

                    {/* AI disclaimer */}
                    {answer && (
                        <p className="text-[10px] text-muted-foreground/40 italic">
                            AI-generated response
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
