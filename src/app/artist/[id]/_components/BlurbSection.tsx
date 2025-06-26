"use client"

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    content?: string;
    link?: string;
}

interface BlurbSectionProps {
  wikiBlurb?: string;
  wikiLink?: string;
  artistName: string;
  aiBlurb?: string;
}

function Modal({ isOpen, onClose, title, content, link}: ModalProps) {
    if (!isOpen) return null;
    
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z=50">
            <div className="bg-white p-6 rounded-lg max-w-2x1 max-h-96 overflow-y-auto">
                <h3 className="text-x1 font-bold mb-4">{title}</h3>
                <p className="text-black mb-4">{content}</p>
                {link && <a href={link} className="text-blue-600 underline block mb-4">View Source</a>}
                <button onClick={onClose} className="text-blue-600 underline">Close</button>
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
            <div className="h-24 relative">
                {wikiBlurb ? (
                    <>
                        <div className="h-full overflow-hidden">
                            <p className="text-black">{wikiBlurb}</p>
                        </div>
                        {wikiBlurb.length > 200 && (
                            <button
                                className="absolute bottom-0 right-0 bg-white text-blue-600 text-sm underline"
                                onClick={() => setOpenModal('wiki')}
                            >
                                Read More
                            </button>
                        )}
                    </>
                    ) : (
                        <p className="text-gray-500 italic pl-2">No Wikipedia content available</p>
                    )}
            </div>
        </TabsContent>
        
        <TabsContent value="ai-generated">
            <div className="h-24 relative">
                {aiBlurb ? (
                    <>
                        <div className="h-full overflow-hidden">
                            <p className="text-black">{aiBlurb}</p>
                        </div>
                        {aiBlurb.length > 200 && (
                            <button
                                className="absolute bottom-0 right-0 bg-white text-blue-600 text-sm underline"
                                onClick={() => setOpenModal('ai')}
                            >
                                Read More
                            </button>
                        )}
                    </>
                    ) : (
                        <p className="text-gray-500 italic pl-2">No AI summary available</p>
                    )}
            </div>
        </TabsContent>
      </Tabs>

    <Modal
        isOpen={openModal === 'wiki'}
        onClose={() => setOpenModal(null)}
        title="Wikipedia"
        content={wikiBlurb}
        link={wikiLink}
    />

    <Modal
        isOpen={openModal === 'ai'}
        onClose={() => setOpenModal(null)}
        title="AI Summary"
        content={aiBlurb}
    />

    </div>
  );
}
