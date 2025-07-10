"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface FunFactsMobileProps {
  artistId: string;
}

type FactType = "surprise" | "lore" | "bts" | "activity";

export default function FunFactsMobile({ artistId }: FunFactsMobileProps) {
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
    <div className="bg-white rounded-lg shadow-lg p-4 space-y-4 md:hidden">
      <h2 className="text-2xl font-bold text-black">Fun Facts</h2>
      <div className="relative">
        {/* Buttons List */}
        <div className={fact ? "invisible pointer-events-none" : "flex flex-col space-y-2"}>
          {buttons.map(({ type, label, icon }) => (
            <Button
              key={type}
              variant="outline"
              className="w-full flex items-center justify-center gap-4 text-base font-semibold border-2"
              onClick={() => fetchFact(type)}
            >
              <span className="text-2xl">{icon}</span>
              <span>{label}</span>
            </Button>
          ))}
        </div>

        {/* Overlay Fact Box */}
        {(loading || fact !== null) && (
          <div className="absolute inset-0 flex flex-col bg-white rounded-lg border-2 border-gray-300 overflow-y-auto p-4">
            {/* Close button */}
            <button
              className="ml-auto text-lg font-bold text-gray-700 hover:text-black"
              aria-label="Close fun fact"
              onClick={() => {
                setFact(null);
                setLoading(false);
              }}
            >
              ×
            </button>
            {loading ? (
              <p className="text-center text-sm">Loading...</p>
            ) : (
              <p className="text-sm text-black whitespace-pre-line mt-2">{fact}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
} 