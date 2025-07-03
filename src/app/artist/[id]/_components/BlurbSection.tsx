"use client"

import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { exists } from "drizzle-orm";


interface BlurbSectionProps {
  wikiBlurb?: string;
  wikiLink?: string;
  artistName: string;
  aiBlurb?: string;
  artistId: string;
}

export default function BlurbSection({ 
  wikiBlurb, 
  wikiLink, 
  artistName, 
  artistId
}: BlurbSectionProps) {
  // State to track which tab is active (defaults to 'wikipedia')
  const [activeTab, setActiveTab] = useState<string>("ai-generated");
  const [openModal, setOpenModal] = useState<'wiki' | 'ai' | null>(null);
  const [aiBlurb, setAiBlurb] = useState<string | undefined>();
  const [loadingAi, setLoadingAi] = useState(false);

  useEffect(() => {
    if (activeTab === "ai-generated" && !aiBlurb && !loadingAi) {
      setLoadingAi(true);
      fetch(`/api/artistBio/${artistId}`)
        .then(async (res) => {
          if (!res.ok) throw new Error("Failed to load AI bio");
          const json = await res.json();
          setAiBlurb(json.bio as string);
        })
        .catch(() => setAiBlurb("Failed to load AI bio."))
        .finally(() => setLoadingAi(false));
    }
  }, [activeTab, aiBlurb, artistId, loadingAi]);

  return (
    <div className="mb-4">
      <Tabs value={activeTab} onValueChange={(value) => {
            setActiveTab(value);
            if (openModal) {
                setOpenModal(value === "ai-generated" ? "ai" : "wiki");
            }
        }} 
            className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="ai-generated">Music Nerd</TabsTrigger>
          <TabsTrigger value="wikipedia">Wikipedia</TabsTrigger>
        </TabsList>
        
        <TabsContent value="wikipedia">
            <div className="relative">
                {/* Initial text box */}
                <div className="h-28 relative border border-gray-200 rounded-lg bg-white p-3 overflow-hidden">
                    {wikiBlurb ? (
                        <>
                            <p className="text-black">{wikiBlurb}</p>
                            {wikiBlurb && wikiBlurb.length > 200 &&  (
                                <>
                                    {/* Gradient overlay */}
                                    <div className="absolute bottom-0 right-2 w-32 h-8 bg-gradient-to-l from-white via-white/100 to-transparent pointer-events-none"></div>
                                    <button
                                        className="absolute bottom-1 right-2 bg-transparent text-blue-600 text-sm underline z-10"
                                        onClick={() => setOpenModal('wiki')}
                                    >
                                        Read More
                                    </button>
                                </>
                            )}
                        </>
                    ) : (
                        <p className="text-gray-500 italic">No Wikipedia content available</p>
                    )}
                </div>
                {/* Expanded box */}
                {openModal === 'wiki' && wikiBlurb && (
                    <div className="absolute top-0 left-0 w-full bg-white border border-gray-200 rounded-lg shadow-lg z-30 p-3 max-h-96 overflow-y-auto">
                        <p className="text-black mb-4">{wikiBlurb}</p>
                        {wikiLink && (
                            <a href={wikiLink} className="absolute bottom-1 left-2 text-blue-600 text-sm underline">
                                View Source
                            </a>
                        )}
                        <button
                            className="absolute bottom-1 right-2 bg-white text-blue-600 text-sm underline"
                            onClick={() => setOpenModal(null)}
                        >
                            Show less
                        </button>
                    </div>
                )}
            </div>
        </TabsContent>
        
        <TabsContent value="ai-generated">
            <div className="relative">
                {/* Initial text box */}
                <div className="h-28 relative border border-gray-200 rounded-t-lg bg-white p-3 overflow-hidden">
                    {loadingAi ? (
                        <p className="text-gray-500 italic">Loading AI Summary...</p>
                    ) : (aiBlurb ? (
                        <>  
                            <p className="text-black">{aiBlurb}</p>
                            {aiBlurb && aiBlurb.length > 200 && (
                                <>
                                    {/* Gradient overlay */}
                                    <div className="absolute bottom-0 right-2 w-32 h-8 bg-gradient-to-l from-white via-white/100 to-transparent pointer-events-none"></div>
                                    <button
                                        className="absolute bottom-1 right-2 bg-transparent text-blue-600 text-sm underline z-10"
                                        onClick={() => setOpenModal('ai')}
                                    >
                                        Read More
                                    </button>
                                </>
                            )}
                        </>
                    ) : (
                        <p className="text-gray-500 italic">No AI summary is available</p>
                ))}
                </div>
                {/* Expanded box */}
                {openModal === 'ai' && (
                    <div className="absolute top-0 left-0 w-full bg-white border border-gray-200 rounded-lg shadow-lg z-30 p-3 max-h-96 overflow-y-auto">
                        <p className="text-black mb-4">{aiBlurb}</p>
                        <button
                            className="absolute right-2 bg-white text-blue-600 text-sm underline"
                            onClick={() => setOpenModal(null)}
                        >
                            Show less
                        </button>
                    </div>
                )}
            </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
