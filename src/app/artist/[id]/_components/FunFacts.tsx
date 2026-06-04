"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface FunFactsProps {
    artistId: string;
}

type FactType = "surprise" | "lore" | "bts" | "activity";

const PROMPT_DESCRIPTIONS: Record<FactType, string> = {
    lore: "Uncover hidden stories and background about this artist",
    bts: "Learn about the creative process and production details",
    activity: "Find out what this artist has been up to recently",
    surprise: "Get a random fun fact you might not know",
};

const buttons: { type: FactType; label: string; icon: string }[] = [
    { type: "lore", label: "Lore Drop", icon: "📖" },
    { type: "bts", label: "Behind the Scenes", icon: "🎬" },
    { type: "activity", label: "Activity", icon: "👀" },
    { type: "surprise", label: "Surprise Me!", icon: "🎲" },
];

export default function FunFacts({ artistId }: FunFactsProps) {
    const [fact, setFact] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const fetchFact = async (type: FactType) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/funFacts/${type}?id=${artistId}`);
            const data = await res.json();

            if (!res.ok || data.error) {
                console.error("API error:", data.error || `HTTP ${res.status}`);
                setFact("Couldn't fetch fact. Try again later.");
                return;
            }

            setFact(data.text || "Couldn't fetch fact. Try again later.");
        } catch (err) {
            console.error("Error fetching fun fact", err);
            setFact("Couldn't fetch fact. Try again later.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-3">
            <div className="relative">
                {/* Buttons grid */}
                <div className={fact ? "invisible pointer-events-none" : "grid grid-cols-2 sm:grid-cols-4 gap-2"}>
                    <TooltipProvider>
                        {buttons.map(({ type, label, icon }) => (
                            <Tooltip key={type} delayDuration={300}>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className="w-full flex items-center justify-center text-sm font-semibold backdrop-blur-sm bg-white/50 dark:bg-white/5 border border-white/40 dark:border-white/10 hover:bg-white/70 dark:hover:bg-white/15 transition-all fun-facts-button"
                                        onClick={() => fetchFact(type)}
                                    >
                                        <span className="flex items-baseline gap-2">
                                            <span
                                                className={`text-lg ${type === "lore" || type === "bts" ? "relative -top-0.5" : ""}`}
                                            >
                                                {icon}
                                            </span>
                                            <span className="leading-none text-black dark:text-white text-xs sm:text-sm">{label}</span>
                                        </span>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="whitespace-nowrap">
                                    <p>{PROMPT_DESCRIPTIONS[type]}</p>
                                </TooltipContent>
                            </Tooltip>
                        ))}
                    </TooltipProvider>
                </div>

                {/* Overlay Fact Box — glass panel */}
                {(fact || loading) && (
                    <div className="absolute inset-0 flex flex-col glass-subtle shadow-lg overflow-y-auto overflow-x-hidden pt-2 pb-2 pr-1 pl-4">
                        <button
                            className="sticky top-0.5 ml-auto mr-1 flex h-6 w-6 items-center justify-center text-xl font-bold text-white border border-white/20 rounded-md bg-pastypink/80 backdrop-blur-sm hover:bg-pastypink focus:outline-none leading-none z-10 transition-colors"
                            aria-label="Close fun fact"
                            onClick={() => {
                                setFact(null);
                                setLoading(false);
                            }}
                        >
                            <span className="relative -top-0.5">&times;</span>
                        </button>
                        {loading ? (
                            <p className="text-center text-sm">Loading...</p>
                        ) : (
                            <p className="text-sm text-black dark:text-white whitespace-pre-line mt-0 pr-7">{fact}</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
