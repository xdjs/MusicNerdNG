"use client"

import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";

interface BlurbSectionProps {
  wikiBlurb?: string;
  wikiLink?: string;
  artistName: string;
  artistId: string;
}

export default function BlurbSection({ 
  wikiBlurb, 
  wikiLink, 
  artistName, 
  artistId
}: BlurbSectionProps) {
  // State to track which tab is active (defaults to 'wikipedia')
  const [activeTab, setActiveTab] = useState<string>("wikipedia");
  const [aiBlurb, setAiBlurb] = useState<string | undefined>();
  const [loadingAi, setLoadingAi] = useState(false);

  useEffect(() => {
    if (activeTab === "ai-generated" && !aiBlurb && !loadingAi) {
      setLoadingAi(true);
      fetch(`/api/artistBio/${artistId}`)
        .then(async (res) => {
          if (!res.ok) throw new Error("Failed to load bio");
          const json = await res.json();
          setAiBlurb(json.bio as string);
        })
        .catch(() => setAiBlurb("Failed to load AI bio."))
        .finally(() => setLoadingAi(false));
    }
  }, [activeTab, aiBlurb, artistId, loadingAi]);

  return (
    <div className="mb-4">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="wikipedia">
            Wikipedia
          </TabsTrigger>
          <TabsTrigger value="ai-generated">
            AI Generated
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="wikipedia">
           {wikiBlurb ? (
            <>
            <p className="text-black mb-4">{wikiBlurb}</p>
            {wikiLink && <Link href={wikiLink}>WIKIPEDIA</Link>}
            </>
            ) : (
            <p className="text-gray-500 italic pl-2">
                No Wikipedia content available
            </p>
            )}
        </TabsContent>
        
        <TabsContent value="ai-generated">
          {loadingAi && (
            <p className="text-gray-500 italic pl-2">Loading AI bio…</p>
          )}
          {!loadingAi && aiBlurb && (
            <p className="text-black mb-4 whitespace-pre-wrap">{aiBlurb}</p>
          )}
          {!loadingAi && !aiBlurb && (
            <p className="text-gray-500 italic pl-2">No AI bio available.</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
