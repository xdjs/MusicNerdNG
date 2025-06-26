"use client"

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";

interface ExpandingContentProps {
    isOpen: boolean;
    onClose: () => void;
    content?: string;
    link?: string;
}

interface BlurbSectionProps {
  wikiBlurb?: string;
  wikiLink?: string;
  artistName: string;
  aiBlurb?: string;
}

function ExpandingContent({ isOpen, onClose, content, link }: ExpandingContentProps) {
    return (
        <div className={`overflow-hidden transition-all duration-300 ease-in-out ${
            isOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
        }`}>
            <div className="bg-white border border-gray-200 rounded-b-lg p-4 shadow-lg">
                <p className="text-black mb-4">{content}</p>
                {link && (
                    <a href={link} className="text-blue-600 underline block mb-4">
                        View Source
                    </a>
                )}
                <button onClick={onClose} className="text-blue-600 underline text-sm">
                    Show Less
                </button>
            </div>
        </div>
    )
}

export default function BlurbSection({ 
  wikiBlurb, 
  wikiLink, 
  artistName, 
  aiBlurb 
}: BlurbSectionProps) {
  // State to track which tab is active (defaults to 'wikipedia')
  const [activeTab, setActiveTab] = useState<string>("wikipedia");
  const [openModal, setOpenModal] = useState<'wiki' | 'ai' | null>(null);



  return (
    <div className="mb-4">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="wikipedia">Wikipedia</TabsTrigger>
          <TabsTrigger value="ai-generated">AI Generated</TabsTrigger>
        </TabsList>
        
        <TabsContent value="wikipedia">
            <div className="relative">
                <div className="h-24 relative border border-gray-200 rounded-t-lg bg-white p-4 overflow-hidden">
                    {wikiBlurb ? (
                        <>
                            <p className="text-black line-clamp-3">{wikiBlurb}</p>
                            {wikiBlurb.length > 200 && (
                                <button
                                    className="absolute bottom-2 right-2 bg-white text-blue-600 text-sm underline z-10"
                                    onClick={() => setOpenModal(openModal === 'wiki' ? null : 'wiki')}
                                >
                                    {openModal === 'wiki' ? 'Show less' : 'Read More'}
                                </button>
                            )}
                        </>
                    ) : (
                        <p className="text-gray-500 italic">No Wikipedia content available</p>
                    )}
                </div>
                
                <div className={`absolute top-24 left-0 w-full bg-white border-l border-r border-b border-gray-200 rounded-b-lg shadow-lg z-500 transition-all duration-300 ease-in-out overflow-hidden ${
                    openModal === 'wiki' ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0 pointer-events-none'
                }`}>
                    <div className="relative p-4">
                        <p className="text-black" style={{ marginTop: '-6rem' }}>
                            {wikiBlurb}
                        </p>
                    </div>
                    {wikiLink && (
                        <a href={wikiLink} className="text-blue-600 underline block mt-4 mx-4">
                            View Source
                        </a>
                    )}
                    <button
                        className="absolute bottom-2 right-2 bg-white text-blue-600 text-sm underline"
                        onClick={() => setOpenModal(null)}
                    >
                        Show less
                    </button>
                </div>
            </div>
        </TabsContent>
        
        <TabsContent value="ai-generated">
            <div className="relative">
                <div className="h-24 relative border border-gray-200 rounded-t-lg bg-white p-4 overflow-hidden">
                    {aiBlurb ? (
                        <>
                            <p className="text-black line-clamp-3">{aiBlurb}</p>
                            {aiBlurb.length > 200 && (
                                <button
                                    className="absolute bottom-2 right-2 bg-white text-blue-600 text-sm underline z-10"
                                    onClick={() => setOpenModal(openModal === 'ai' ? null : 'ai')}
                                >
                                    {openModal === 'ai' ? 'Show less' : 'Read More'}
                                </button>
                            )}
                        </>
                    ) : (
                        <p className="text-gray-500 italic">No AI Summary available</p>
                    )}
                </div>
                
                <div className={`absolute top-24 left-0 w-full bg-white border-l border-r border-b border-gray-200 rounded-b-lg shadow-lg z-50 transition-all duration-300 ease-in-out overflow-hidden ${
                    openModal === 'ai' ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0 pointer-events-none'
                }`}>
                    <div className="relative p-4">
                        <p className="text-black" style={{ marginTop: '-6rem' }}>
                            {aiBlurb}
                        </p>
                    </div>
                    <button
                        className="absolute bottom-2 right-2 bg-white text-blue-600 text-sm underline"
                        onClick={() => setOpenModal(null)}
                    >
                        Show less
                    </button>
                </div>
            </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
