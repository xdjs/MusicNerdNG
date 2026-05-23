"use client";

import { useContext, useEffect, useState } from "react";
import { EditModeContext } from "@/app/_components/EditModeContext";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Pin, Trash2 } from "lucide-react";
import {
    getArtistBioVersions,
    pinBioVersionAction,
    deleteBioVersionAction,
} from "@/app/actions/dashboardActions";

interface BioVersion {
    id: string;
    artistId: string;
    bioText: string;
    isPinned: boolean;
    createdAt: string;
}

export default function BioVersionHistory({ artistId }: { artistId: string }) {
    const { isEditing } = useContext(EditModeContext);
    const { toast } = useToast();
    const [versions, setVersions] = useState<BioVersion[]>([]);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (!isEditing) return;
        let active = true;
        setLoading(true);
        getArtistBioVersions(artistId)
            .then(res => {
                if (active && res.success && res.versions) {
                    const sorted = [...res.versions].sort(
                        (a, b) => new Date((b as BioVersion).createdAt).getTime() - new Date((a as BioVersion).createdAt).getTime()
                    );
                    setVersions(sorted as BioVersion[]);
                }
            })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [isEditing, artistId]);

    if (!isEditing) return null;

    async function handlePin(id: string) {
        const res = await pinBioVersionAction(id, artistId);
        if (res.success) {
            setVersions(prev => prev.map(v => ({ ...v, isPinned: v.id === id })));
        } else {
            toast({ title: "Couldn't pin version", description: res.error ?? "Please try again", variant: "destructive" });
        }
    }

    async function handleDelete(id: string) {
        const res = await deleteBioVersionAction(id, artistId);
        if (res.success) {
            setVersions(prev => prev.filter(v => v.id !== id));
        } else {
            toast({ title: "Couldn't delete version", description: res.error ?? "Please try again", variant: "destructive" });
        }
    }

    return (
        <div className="space-y-2">
            <button
                onClick={() => setOpen(o => !o)}
                className="text-xs text-muted-foreground hover:text-pastypink"
            >
                {open ? "Hide" : "Show"} version history ({versions.length})
            </button>
            {open && (
                <div className="space-y-2">
                    {loading && (
                        <p className="text-xs text-muted-foreground italic">Loading versions…</p>
                    )}
                    {!loading && versions.length === 0 && (
                        <p className="text-xs text-muted-foreground italic">No saved versions yet.</p>
                    )}
                    {versions.map(v => (
                        <div key={v.id} className="glass-subtle p-2 flex items-start justify-between gap-2">
                            <p className="text-xs text-black dark:text-white line-clamp-3">{v.bioText}</p>
                            <div className="flex items-center gap-1 shrink-0">
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    aria-label="Pin"
                                    disabled={v.isPinned}
                                    onClick={() => handlePin(v.id)}
                                >
                                    <Pin size={13} className={v.isPinned ? "text-pastypink" : ""} />
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    aria-label="Delete"
                                    disabled={v.isPinned}
                                    onClick={() => handleDelete(v.id)}
                                >
                                    <Trash2 size={13} />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
