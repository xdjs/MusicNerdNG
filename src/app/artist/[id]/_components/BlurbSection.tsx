"use client"

import { useState, useEffect } from "react";

interface BlurbSectionProps {
  artistName: string;
  artistId: string;
}

export default function BlurbSection({ artistName, artistId }: BlurbSectionProps) {
  const [openModal, setOpenModal] = useState<boolean>(false);
  const [aiBlurb, setAiBlurb] = useState<string | undefined>();
  const [loadingAi, setLoadingAi] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBio = async () => {
    setLoadingAi(true);
    setError(null);
    
    try {
      const res = await fetch(`/api/artistBio/${artistId}`);
      const json = await res.json();
      
      if (!res.ok) {
        throw new Error(json.error || "Failed to load summary");
      }
      
      setAiBlurb(json.bio as string);
    } catch (err: any) {
      console.error("Error fetching bio:", err);
      const errorMessage = err.message || "Failed to load summary";
      setError(errorMessage);
      setAiBlurb("No summary is available");
    } finally {
      setLoadingAi(false);
    }
  };

  useEffect(() => {
    if (!aiBlurb && !loadingAi && !error) {
      fetchBio();
    }
  }, [aiBlurb, artistId, loadingAi, error]);

  const showRetryButton = error && !loadingAi;

  return (
    <div className="mb-4">
      <div className="relative">
        {/* Initial text box */}
        <div className="h-28 relative border border-gray-200 rounded-lg bg-white p-3 overflow-hidden">
          {loadingAi ? (
            <p className="text-gray-500 italic">Loading summary...</p>
          ) : (aiBlurb ? (
            <>  
              <p className="text-black">{aiBlurb}</p>
              {aiBlurb && aiBlurb.length > 200 && !error && (
                <>
                  {/* Gradient overlay */}
                  <div className="absolute bottom-0 right-2 w-32 h-8 bg-gradient-to-l from-white via-white/100 to-transparent pointer-events-none"></div>
                  <button
                    className="absolute bottom-1 right-2 bg-transparent text-blue-600 text-sm underline z-10"
                    onClick={() => setOpenModal(true)}
                  >
                    Read More
                  </button>
                </>
              )}
              {showRetryButton && (
                <button
                  className="absolute bottom-1 right-2 bg-blue-600 hover:bg-blue-700 text-white text-sm px-2 py-1 rounded z-10"
                  onClick={fetchBio}
                >
                  Retry
                </button>
              )}
            </>
          ) : (
            <p className="text-gray-500 italic">No summary is available</p>
          ))}
        </div>
        {/* Expanded box */}
        {openModal && !error && (
          <div className="absolute top-0 left-0 w-full bg-white border border-gray-200 rounded-lg shadow-lg z-30 p-3 max-h-96 overflow-y-auto">
            <p className="text-black mb-4">{aiBlurb}</p>
            <button
              className="absolute right-2 bg-white text-blue-600 text-sm underline"
              onClick={() => setOpenModal(false)}
            >
              Show less
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
