"use client";

import { useContext, useState, useRef, useMemo, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { EditModeContext } from "@/app/_components/EditModeContext";
import SourceCard from "./SourceCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  updateSourceStatus,
  updateSourceType,
  removeVaultSource,
  removeVaultSources,
  addVaultSource,
  searchWebForSources,
} from "@/app/actions/dashboardActions";
import { SOURCE_TYPE_COLORS, type SourceType } from "@/lib/sourceTypes";
import type { ArtistVaultSource } from "@/server/db/DbTypes";

interface VaultManagerProps {
  artistId: string;
  pendingSources: ArtistVaultSource[];
  approvedSources: ArtistVaultSource[];
}

export default function VaultManager({ artistId, pendingSources, approvedSources }: VaultManagerProps) {
  const { isEditing } = useContext(EditModeContext);
  const { toast } = useToast();
  const router = useRouter();
  const [pending, setPending] = useState(pendingSources);
  const [approved, setApproved] = useState(approvedSources);
  const [searching, setSearching] = useState(false);
  const [searchPhraseIdx, setSearchPhraseIdx] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [addingUrl, setAddingUrl] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of approved) {
      const t = s.type ?? "article";
      counts[t] = (counts[t] ?? 0) + 1;
    }
    return counts;
  }, [approved]);

  const uniqueTypes = useMemo(() => Object.keys(typeCounts).sort(), [typeCounts]);

  const filteredApproved = useMemo(
    () => (typeFilter ? approved.filter(s => (s.type ?? "article") === typeFilter) : approved),
    [approved, typeFilter]
  );

  // Rotating status phrases for the web-search button so a 10–30s wait feels alive.
  const SEARCH_PHRASES = useMemo(
    () => ["Searching the web…", "Reading sources…", "Finding press mentions…", "Almost there…"],
    []
  );
  useEffect(() => {
    if (!searching) {
      setSearchPhraseIdx(0);
      return;
    }
    const id = setInterval(() => {
      setSearchPhraseIdx((i) => (i + 1) % SEARCH_PHRASES.length);
    }, 2500);
    return () => clearInterval(id);
  }, [searching, SEARCH_PHRASES.length]);

  if (!isEditing) return null;

  async function handleApprove(id: string) {
    const res = await updateSourceStatus(id, "approved");
    if (res.success) {
      const moved = pending.find(s => s.id === id);
      setPending(prev => prev.filter(s => s.id !== id));
      if (moved) setApproved(prev => [{ ...moved, status: "approved" }, ...prev]);
      router.refresh();
    } else {
      toast({ title: "Couldn't approve source", description: res.error ?? "Please try again", variant: "destructive" });
    }
  }

  async function handleReject(id: string) {
    const res = await updateSourceStatus(id, "rejected");
    if (res.success) {
      setPending(prev => prev.filter(s => s.id !== id));
      router.refresh();
    } else {
      toast({ title: "Couldn't reject source", description: res.error ?? "Please try again", variant: "destructive" });
    }
  }

  async function handleDelete(id: string) {
    const res = await removeVaultSource(id);
    if (res.success) {
      setPending(prev => prev.filter(s => s.id !== id));
      setApproved(prev => prev.filter(s => s.id !== id));
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      router.refresh();
    } else {
      toast({ title: "Couldn't delete source", description: res.error ?? "Please try again", variant: "destructive" });
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    setDeleting(true);
    try {
      const res = await removeVaultSources(ids);
      if (res.success) {
        const idSet = new Set(ids);
        setApproved(prev => prev.filter(s => !idSet.has(s.id)));
        setSelectedIds(new Set());
        toast({ title: `${res.count ?? ids.length} source${(res.count ?? ids.length) > 1 ? "s" : ""} deleted` });
        router.refresh();
      } else {
        toast({ title: "Couldn't delete sources", description: res.error ?? "Please try again", variant: "destructive" });
      }
    } finally {
      setDeleting(false);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllApproved() {
    if (selectedIds.size === filteredApproved.length && filteredApproved.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredApproved.map(s => s.id)));
    }
  }

  async function handleTypeChange(id: string, type: string) {
    const res = await updateSourceType(id, type);
    if (!res.success) {
      toast({ title: "Couldn't update type", description: res.error ?? "Please try again", variant: "destructive" });
    } else {
      setPending(prev => prev.map(s => s.id === id ? { ...s, type } : s));
      setApproved(prev => prev.map(s => s.id === id ? { ...s, type } : s));
      router.refresh();
    }
  }

  async function handleAddUrl() {
    const url = newUrl.trim();
    if (!url) return;
    setAddingUrl(true);
    try {
      const res = await addVaultSource(artistId, url);
      if (res.success) {
        setNewUrl("");
        toast({ title: "Source added", description: "Added to pending review." });
        router.refresh();
      } else {
        toast({ title: "Couldn't add source", description: res.error ?? "Please try again", variant: "destructive" });
      }
    } finally {
      setAddingUrl(false);
    }
  }

  async function handleWebSearch() {
    setSearching(true);
    try {
      const res = await searchWebForSources(artistId);
      if (res.success) {
        if (!res.count) {
          toast({ title: "No new sources found" });
        } else {
          toast({ title: `Found ${res.count} source(s)`, description: "Refresh to review them." });
        }
        router.refresh();
      } else {
        toast({ title: "Search failed", description: res.error ?? "Please try again", variant: "destructive" });
      }
    } finally {
      setSearching(false);
    }
  }

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("artistId", artistId);
      const res = await fetch("/api/vault/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.source) {
        setApproved(prev => [data.source, ...prev]);
        toast({ title: "File uploaded" });
        router.refresh();
      } else {
        toast({ title: `Couldn't upload ${file.name}`, description: data.error || "Upload failed", variant: "destructive" });
      }
    } catch {
      toast({ title: `Couldn't upload ${file.name}`, description: "Network error", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    for (const f of files) await handleUpload(f);
  }

  return (
    <div className="space-y-4">
      {/* What the vault is for */}
      <p className="text-xs text-muted-foreground leading-relaxed">
        Your vault powers your profile. Approved sources — articles, interviews, reviews, uploaded files — become context for your AI-generated <strong>Artist Summary</strong> and the <strong>Ask About</strong> answers. The more quality sources you add, the better and more accurate that content gets.
      </p>

      {/* Add a source by URL */}
      <div className="flex gap-2">
        <Input
          type="url"
          placeholder="Add a source by URL…"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddUrl(); } }}
          className="flex-1 text-black dark:text-white"
        />
        <Button size="sm" variant="outline" className="text-black dark:text-white" disabled={addingUrl || !newUrl.trim()} onClick={handleAddUrl}>
          {addingUrl ? "Adding…" : "Add"}
        </Button>
      </div>

      {/* Upload (drop zone + click) and web search */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`rounded-lg border-2 border-dashed p-4 transition-colors ${
          dragOver ? "border-pastypink bg-pastypink/10" : "border-white/30 dark:border-white/15"
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.txt,.md,.csv,.json,.doc,.docx,.png,.jpg,.jpeg,.webp,.mp3,.wav"
          className="hidden"
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            for (const f of files) await handleUpload(f);
          }}
        />
        <p className="text-sm text-muted-foreground mb-2">Drag &amp; drop files here, or use the buttons below.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="text-black dark:text-white" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? "Uploading…" : "Upload file"}
          </Button>
          <Button size="sm" variant="outline" className="text-black dark:text-white" disabled={searching} onClick={handleWebSearch}>
            {searching ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" aria-hidden="true" />
                <span aria-live="polite">{SEARCH_PHRASES[searchPhraseIdx]}</span>
              </>
            ) : (
              "Search web for sources"
            )}
          </Button>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Pending review ({pending.length})</h3>
          {pending.map(s => (
            <SourceCard key={s.id} source={s} showActions
              onApprove={handleApprove} onReject={handleReject}
              onDelete={handleDelete} onTypeChange={handleTypeChange} />
          ))}
        </div>
      )}

      {approved.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Approved ({approved.length})</h3>

          {/* Type filter chips */}
          {uniqueTypes.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setTypeFilter(null)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  typeFilter === null
                    ? "bg-pastypink text-white"
                    : "glass-subtle text-muted-foreground hover:text-black dark:hover:text-white"
                }`}
              >
                All ({approved.length})
              </button>
              {uniqueTypes.map((t) => {
                const colors = SOURCE_TYPE_COLORS[t as SourceType] ?? SOURCE_TYPE_COLORS.article;
                const isActive = typeFilter === t;
                return (
                  <button
                    key={t}
                    onClick={() => setTypeFilter(isActive ? null : t)}
                    className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors border ${
                      isActive
                        ? `${colors.bg} ${colors.text} ${colors.border}`
                        : "glass-subtle text-muted-foreground hover:text-black dark:hover:text-white border-transparent"
                    }`}
                  >
                    {t} ({typeCounts[t]})
                  </button>
                );
              })}
            </div>
          )}

          {/* Bulk-select controls */}
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={selectedIds.size === filteredApproved.length && filteredApproved.length > 0}
                onChange={selectAllApproved}
                className="h-4 w-4 rounded border-gray-300 text-pastypink focus:ring-pastypink"
              />
              Select all{typeFilter ? ` (${typeFilter})` : ""}
            </label>
            {selectedIds.size > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleBulkDelete}
                disabled={deleting}
                className="text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950 text-xs h-7"
              >
                {deleting ? "Deleting…" : `Delete ${selectedIds.size} selected`}
              </Button>
            )}
          </div>

          {filteredApproved.map(s => (
            <SourceCard key={s.id} source={s} showActions={false}
              onDelete={handleDelete} onTypeChange={handleTypeChange}
              selected={selectedIds.has(s.id)} onSelect={toggleSelect} />
          ))}
        </div>
      )}

      {pending.length === 0 && approved.length === 0 && (
        <p className="text-sm text-muted-foreground italic">No vault sources yet. Upload a file or search the web to get started.</p>
      )}
    </div>
  );
}
