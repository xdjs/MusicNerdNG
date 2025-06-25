"use client"

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";

interface BlurbSectionProps {
  wikiBlurb?: string;
  wikiLink?: string;
  artistName: string;
  // AI blurb will be added later when you implement the AI functionality
  aiBlurb?: string;
}

export default function BlurbSection({ 
  wikiBlurb, 
  wikiLink, 
  artistName, 
  aiBlurb 
}: BlurbSectionProps) {
  // State to track which tab is active (defaults to 'wikipedia')
  const [activeTab, setActiveTab] = useState<string>("wikipedia");



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
            <p className="text-gray-500 italic">
                  No Wikipedia content available
            </p>
            )}
        </TabsContent>
        
        <TabsContent value="ai-generated">
          {aiBlurb ? (
            <p className="text-black mb-4">{aiBlurb}</p>
          ) : (
            <p className="text-gray-500 italic">
                AI-generated description coming soon
            </p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
