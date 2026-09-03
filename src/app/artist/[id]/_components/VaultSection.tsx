"use client";

import { useContext } from "react";
import { EditModeContext } from "@/app/_components/EditModeContext";
import RevealSection from "./RevealSection";
import PressAndFeatures from "./PressAndFeatures";
import VaultManager from "./VaultManager";
import type { ArtistVaultSource } from "@/server/db/DbTypes";

interface VaultSectionProps {
  artistId: string;
  pendingSources: ArtistVaultSource[];
  approvedSources: ArtistVaultSource[];
}

export default function VaultSection({ artistId, pendingSources, approvedSources }: VaultSectionProps) {
  const { isEditing, canEdit } = useContext(EditModeContext);

  const show = approvedSources.length > 0 || (canEdit && isEditing);
  if (!show) return null;

  return (
    <RevealSection className="glass p-4 sm:p-5 space-y-3">
      <h2 className="text-black dark:text-white text-xl font-bold">Lore</h2>
      {/* Public carousel only outside edit mode; VaultManager owns the approved
          list while editing (its own optimistic state) to avoid a stale-card flash. */}
      {!isEditing && approvedSources.length > 0 && <PressAndFeatures sources={approvedSources} />}
      {canEdit && isEditing && (
        <VaultManager artistId={artistId} pendingSources={pendingSources} approvedSources={approvedSources} />
      )}
    </RevealSection>
  );
}
