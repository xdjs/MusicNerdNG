"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface FunFactsDesktopProps {
  artistId: string;
}

type FactType = "surprise" | "lore" | "bts" | "activity";

export default function FunFactsDesktop({ artistId }: FunFactsDesktopProps) {
  const [fact, setFact] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchFact = async (type: FactType) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/funFacts/${type}?id=${artistId}`);
      const data = await res.json();
      setFact(data.text || "Couldn't fetch fact. Try again later.");
    } catch (err) {
      console.error("Error fetching fun fact", err);
      setFact("Couldn't fetch fact. Try again later.");
    } finally {
      setLoading(false);
    }
  };

  const buttons = [
    { type: "lore" as FactType, label: "Lore Drop", icon: "📖" },
    { type: "bts" as FactType, label: "Behind the Scenes", icon: "🎬" },
    { type: "activity" as FactType, label: "Activity", icon: "👀" },
    { type: "surprise" as FactType, label: "Surprise Me!", icon: "🎲" },
  ];

  return (
    <div className="hidden md:block bg-white rounded-lg shadow-2xl p-6 space-y-4 overflow-x-hidden">
      <h2 className="text-2xl font-bold text-black">Fun Facts</h2>
      <div className="relative">
        {/* Buttons List */}
        <div className={fact ? "invisible pointer-events-none" : "flex flex-col space-y-2"}>
          {buttons.map(({ type, label, icon }) => (
            <Button
              key={type}
              variant="outline"
              className="w-full flex items-center justify-center text-base font-semibold border-2"
              onClick={() => fetchFact(type)}
            >
              <span className="flex items-baseline gap-4">
                <span
                  className={`text-2xl ${type === "lore" || type === "bts" ? "relative -top-0.5" : ""}`}
                >
                  {icon}
                </span>
                <span className="leading-none">{label}</span>
              </span>
            </Button>
          ))}
        </div>

        {/* Overlay Fact Box */}
        {(loading || fact !== null) && (
          <div className="absolute inset-0 flex flex-col bg-white rounded-lg border-2 border-gray-300 shadow-lg overflow-y-auto overflow-x-hidden pt-2 pb-2 pr-1 pl-4">
            {/* Close button */}
            <button
              className="sticky top-0.5 ml-auto mr-1 flex h-6 w-6 items-center justify-center text-xl font-bold text-white border-2 border-gray-300 rounded-md bg-gray-300 hover:bg-gray-400 focus:outline-none leading-none z-10"
              aria-label="Close fun fact"
              onClick={() => {
                setFact(null);
                setLoading(false);
              }}
            >
              <span className="relative -top-0.5">×</span>
            </button>
            {loading ? (
              <p className="text-center text-sm">Loading...</p>
            ) : (
              <p className="text-sm text-black whitespace-pre-line mt-0 pr-7">{fact}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
} 