"use client"

import { useState, useEffect, useContext, useRef } from "react";
import { EditModeContext } from "@/app/_components/EditModeContext";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useArtistBio } from "@/hooks/useArtistBio";
import { ChevronDown, Check } from "lucide-react";
import { saveCurrentBio } from "@/app/actions/dashboardActions";
import BioVersionHistory from "./BioVersionHistory";

interface BlurbSectionProps {
  artistName: string;
  artistId: string;
  initialBio?: string | null;
}

/** Convert **bold** and *italic* markdown to HTML. Input is AI-generated so only these two patterns occur. */
function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

/** Height (px) of the collapsed bio box */
const COLLAPSED_HEIGHT = 112;

export default function BlurbSection({ artistName, artistId, initialBio }: BlurbSectionProps) {
  const { isEditing, canEdit } = useContext(EditModeContext);
  const { toast } = useToast();
  const { bio: aiBlurb, loading: loadingAi, refetch } = useArtistBio(artistId, initialBio);

  const [expanded, setExpanded] = useState(false);
  const [needsTruncation, setNeedsTruncation] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const [editText, setEditText] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isSavingToVault, setIsSavingToVault] = useState(false);
  const [savedToVault, setSavedToVault] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [originalBio, setOriginalBio] = useState<string>("");

  // Update edit text when bio changes
  useEffect(() => {
    if (aiBlurb) {
      setEditText(aiBlurb);
      setOriginalBio(aiBlurb);
    }
  }, [aiBlurb]);

  // Reset the edit text when exiting edit mode without saving
  useEffect(() => {
    if (!isEditing) {
      setEditText(aiBlurb ?? "");
      setOriginalBio(aiBlurb ?? "");
    }
  }, [isEditing, aiBlurb]);

  // Measure content to decide if truncation is needed
  useEffect(() => {
    if (contentRef.current && contentRef.current.scrollHeight > 0) {
      setNeedsTruncation(contentRef.current.scrollHeight > COLLAPSED_HEIGHT);
    } else if (aiBlurb && aiBlurb.length > 200) {
      // Fallback for environments without layout (e.g. JSDOM)
      setNeedsTruncation(true);
    }
  }, [aiBlurb]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => { if (savedTimerRef.current) clearTimeout(savedTimerRef.current); };
  }, []);

  async function handleSave() {
    // Prevent saving empty bios – restore original text instead
    if (editText.trim() === "") {
      setEditText(aiBlurb ?? "");
      return;
    }
    if (isSaving) return;
    setIsSaving(true);
    try {
      const resp = await fetch(`/api/artistBio/${artistId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ bio: editText }),
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok) {
        setOriginalBio(editText);
        // Refetch to update the cache
        refetch();
        toast({ title: "Bio updated" });
      } else {
        toast({ title: "Error saving bio", description: data?.message ?? "Please try again." });
      }
    } catch (e) {
      console.error(e);
      toast({ title: "Error saving bio", description: "Please try again." });
    } finally {
      setIsSaving(false);
    }
  }

  function handleDiscard() {
    setEditText(originalBio);
  }

  async function handleSaveToVault() {
    if (!aiBlurb || isSavingToVault) return;
    setIsSavingToVault(true);
    try {
      const result = await saveCurrentBio(aiBlurb, artistId);
      if (result.success) {
        setSavedToVault(true);
        toast({ title: "Bio saved to vault" });
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setSavedToVault(false), 3000);
      } else {
        toast({ title: "Error", description: result.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to save bio", variant: "destructive" });
    } finally {
      setIsSavingToVault(false);
    }
  }

  async function handleRegenerate() {
    if (isRegenerating) return;
    setIsRegenerating(true);
    try {
      // First try PUT (admin regeneration) - falls back to GET with regenerate param
      const resp = await fetch(`/api/artistBio/${artistId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate: true }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setEditText(data.bio);
        refetch(); // Update the hook's displayed bio
        toast({ title: "Bio regenerated" });
      } else {
        // PUT failed (not admin) — use GET with force-regenerate param
        const getResp = await fetch(`/api/artistBio/${artistId}?regenerate=true`);
        const getData = await getResp.json();
        if (getResp.ok && getData.bio) {
          setEditText(getData.bio);
          refetch(); // Update the hook's displayed bio
          toast({ title: "Bio regenerated" });
        } else {
          toast({ title: "Error regenerating bio", description: getData?.error ?? "Please try again." });
        }
      }
    } catch (e) {
      console.error(e);
      toast({ title: "Error regenerating bio", description: "Please try again." });
    } finally {
      setIsRegenerating(false);
    }
  }

  if (loadingAi) {
    return (
      <div className="glass-subtle p-3" style={{ height: COLLAPSED_HEIGHT }}>
        <p className="text-gray-500 dark:text-gray-400 italic">Loading summary...</p>
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className="space-y-2">
        <textarea
          className="w-full glass-subtle p-3 text-black dark:text-white h-40"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          placeholder="Enter artist bio..."
        />
        <div className="flex flex-wrap justify-between items-center gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRegenerate}
                disabled={isRegenerating || isSaving}
                className="text-gray-700 dark:text-gray-200"
              >
                {isRegenerating ? (
                  <>
                    <img src="/spinner.svg" className="h-3 w-3 mr-1" alt="regenerating" />
                    Regenerating...
                  </>
                ) : (
                  "Regenerate"
                )}
              </Button>
            )}
            {canEdit && aiBlurb && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSaveToVault}
                disabled={isSavingToVault || savedToVault}
                className="text-gray-700 dark:text-gray-200"
              >
                {savedToVault ? (
                  <>
                    <Check size={13} className="mr-1 text-green-500" />
                    Saved
                  </>
                ) : (
                  isSavingToVault ? "Saving..." : "Save to vault"
                )}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleDiscard} disabled={isSaving}>
              Discard
            </Button>
            <Button onClick={handleSave} disabled={isSaving || (editText?.trim() ?? "") === (originalBio?.trim() ?? "")}>
              {isSaving ? <img src="/spinner.svg" className="h-4 w-4" alt="saving" /> : "Save"}
            </Button>
          </div>
        </div>
        <BioVersionHistory artistId={artistId} />
      </div>
    );
  }

  // Non-editing view — smooth expand/collapse
  return (
    <div className="space-y-1.5">
      <div className="glass-subtle p-3 relative">
        {/* Expandable content wrapper */}
        <div
          ref={contentRef}
          className="overflow-hidden transition-[max-height] duration-300 ease-in-out"
          style={{ maxHeight: expanded ? contentRef.current?.scrollHeight ?? "none" : COLLAPSED_HEIGHT }}
        >
          {aiBlurb ? (
            <p
              className="text-black dark:text-white text-sm leading-relaxed"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(aiBlurb) }}
            />
          ) : (
            <p className="text-gray-500 dark:text-gray-400 italic">No summary is available</p>
          )}
        </div>

        {/* Fade gradient when collapsed */}
        {needsTruncation && !expanded && (
          <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-white/80 dark:from-[#1a1a1a]/80 to-transparent rounded-b-xl pointer-events-none" />
        )}
      </div>

      {/* Expand toggle — edit controls live in edit mode only */}
      {needsTruncation && (
        <div className="flex items-center justify-end px-1">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-pastypink transition-colors"
          >
            {expanded ? "Show less" : "Read more"}
            <ChevronDown
              size={13}
              className={`transition-transform duration-300 ${expanded ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      )}
    </div>
  );
}
