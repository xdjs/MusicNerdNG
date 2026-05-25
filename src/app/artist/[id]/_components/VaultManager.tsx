"use client";

import { useContext, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { EditModeContext } from "@/app/_components/EditModeContext";
import SourceCard from "./SourceCard";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  updateSourceStatus,
  updateSourceType,
  removeVaultSource,
  searchWebForSources,
} from "@/app/actions/dashboardActions";
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
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
      router.refresh();
    } else {
      toast({ title: "Couldn't delete source", description: res.error ?? "Please try again", variant: "destructive" });
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
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
        <Button size="sm" variant="outline" className="text-black dark:text-white" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? "Uploading…" : "Upload file"}
        </Button>
        <Button size="sm" variant="outline" className="text-black dark:text-white" disabled={searching} onClick={handleWebSearch}>
          {searching ? "Searching…" : "Search web for sources"}
        </Button>
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
          {approved.map(s => (
            <SourceCard key={s.id} source={s} showActions={false}
              onDelete={handleDelete} onTypeChange={handleTypeChange} />
          ))}
        </div>
      )}

      {pending.length === 0 && approved.length === 0 && (
        <p className="text-sm text-muted-foreground italic">No vault sources yet. Upload a file or search the web to get started.</p>
      )}
    </div>
  );
}
