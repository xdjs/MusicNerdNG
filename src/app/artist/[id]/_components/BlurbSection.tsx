"use client"

import { useState, useEffect, useContext, useRef } from "react";
import { EditModeContext } from "@/app/_components/EditModeContext";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useArtistBio } from "@/hooks/useArtistBio";
import { Check } from "lucide-react";
import { saveCurrentBio } from "@/app/actions/dashboardActions";
import { renderBioMarkdown } from "@/lib/renderBioMarkdown";
import BioVersionHistory from "./BioVersionHistory";

interface BlurbSectionProps {
  artistName: string;
  artistId: string;
  initialBio?: string | null;
}

export default function BlurbSection({ artistName, artistId, initialBio }: BlurbSectionProps) {
  const { isEditing, canEdit } = useContext(EditModeContext);
  const { toast } = useToast();
  const { bio: aiBlurb, loading: loadingAi, refetch } = useArtistBio(artistId, initialBio);

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
        // PUT failed — retry via GET force-regenerate. Both paths are editor-gated now,
        // so this only helps an authorized editor whose PUT hit a transient (non-auth) error.
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
      <div className="glass-subtle p-3 min-h-[80px]">
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

  // Non-editing view — show the full bio (no truncation)
  return (
    <div className="glass-subtle p-3">
      {aiBlurb ? (
        <p
          className="text-black dark:text-white text-sm leading-relaxed"
          dangerouslySetInnerHTML={{ __html: renderBioMarkdown(aiBlurb) }}
        />
      ) : (
        <p className="text-gray-500 dark:text-gray-400 italic">No summary is available</p>
      )}
    </div>
  );
}
