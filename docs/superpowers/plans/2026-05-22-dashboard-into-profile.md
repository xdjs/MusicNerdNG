# Fold Dashboard Into Artist Profile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `/dashboard` route and surface all of its owner/admin capabilities (vault management, bio version history, profile-image upload) as inline edit-mode surfaces on the artist profile page `/artist/[id]`.

**Architecture:** Reuse the profile's existing `EditModeProvider` / `canEdit` (`isClaimedByUser || isAdmin`) gating. New edit-mode-only child components mount inside the existing profile sections. Server-side, extend vault + image authorization to allow admins (mirroring the bio actions' existing `resolveBioArtistId` admin path), and have `page.tsx` fetch pending sources + bio versions only when `canEdit`. The dashboard route and its now-redundant components are deleted; `SourceCard` is relocated for reuse.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Drizzle ORM, NextAuth, Jest 30 + React Testing Library, Tailwind.

**Spec:** `docs/superpowers/specs/2026-05-22-dashboard-into-profile-design.md`

---

## Background facts (verified in code)

- Profile page: `src/app/artist/[id]/page.tsx`. Computes `canEdit` at line ~94, wraps in `EditModeProvider` (line ~100), fetches `approvedSources` only (line ~85), renders the Vault section only when `approvedSources.length > 0` (line ~182).
- `EditModeContext` value shape: `{ isEditing: boolean, toggle: () => void, canEdit: boolean }` (`src/app/_components/EditModeContext.tsx`).
- Vault source shape (`ArtistVaultSource`): `id, artistId, url, title?, snippet?, type?, status, fileName?, fileSize?, filePath?, contentType?, extractedText?, ogImage?, createdAt, updatedAt`.
- Bio version shape (`BioVersion`): `{ id, artistId, bioText, isPinned, createdAt }`.
- Vault upload: `POST /api/vault/upload`, FormData `{ file, artistId }`, returns `{ success: true, source }`.
- Profile image upload: `POST /api/artist/profile-image`, FormData `{ file, artistId }`, returns `{ success: true, imagePath }`.
- **Auth gap:** vault actions + both upload routes authorize via `getApprovedClaimByUserId` and `claim.artistId !== artistId` (no admin path). Bio actions already allow admins via `resolveBioArtistId`. Links already support admins on the profile (shipped).
- No existing dashboard tests. Component-test pattern to mirror: `src/__tests__/components/BlurbSection.test.tsx` (renders inside `EditModeContext.Provider`).
- `/dashboard` hrefs exist in: `src/app/_components/nav/components/Login.tsx` and `src/app/_components/nav/components/PrivyLogin.tsx`.

## File structure (created / modified / deleted)

**Create:**
- `src/app/artist/[id]/_components/VaultManager.tsx` — edit-mode vault management (upload, web search, pending tray, approved list).
- `src/app/artist/[id]/_components/BioVersionHistory.tsx` — edit-mode bio version list (pin/delete).
- `src/app/artist/[id]/_components/SourceCard.tsx` — relocated from dashboard.
- Test files co-located under `src/__tests__/components/` mirroring existing convention.

**Modify:**
- `src/server/utils/queries/dashboardQueries.ts` — add `getVaultSourceById`.
- `src/app/actions/dashboardActions.ts` — admin-aware vault auth.
- `src/app/api/vault/upload/route.ts` and `src/app/api/artist/profile-image/route.ts` — admin-aware auth.
- `src/app/artist/[id]/_components/HeroSection.tsx` — edit-mode image upload overlay.
- `src/app/artist/[id]/_components/BlurbSection.tsx` — mount `BioVersionHistory` in edit mode.
- `src/app/artist/[id]/page.tsx` — fetch pending + bio versions when `canEdit`; render VaultManager unconditionally when `canEdit`.
- `src/app/_components/nav/components/Login.tsx` + `PrivyLogin.tsx` — owner-link to claimed profile, hidden when no claim.
- `src/app/api/user/has-claim/route.ts` — also return the claimed `artistId` (needed by the nav owner-link).

**Delete:**
- `src/app/dashboard/` (the whole directory: `page.tsx`, `_components/DashboardContent.tsx`, `_components/BioVersionsSection.tsx`, `_components/DashboardLinksSection.tsx`). `_components/SourceCard.tsx` is relocated, not deleted.

---

## Task 1: Admin-aware vault authorization (action layer)

Lets admins (not just the owning claimant) manage vault sources, matching how `canEdit` already grants admins edit mode and how bio actions already allow admins.

**Files:**
- Modify: `src/server/utils/queries/dashboardQueries.ts`
- Modify: `src/app/actions/dashboardActions.ts`
- Test: `src/app/actions/__tests__/dashboardActions.vault-auth.test.ts`

- [ ] **Step 1: Add a by-id vault source query**

In `dashboardQueries.ts`, add next to the other vault queries:

```typescript
export async function getVaultSourceById(sourceId: string): Promise<ArtistVaultSource | undefined> {
    return db.query.artistVaultSources.findFirst({
        where: (s, { eq }) => eq(s.id, sourceId),
    });
}
```

(Confirm the table is registered on `db.query` as `artistVaultSources`; if the existing `getVaultSourceByIdAndArtist` uses a different access pattern, copy that pattern instead.)

- [ ] **Step 2: Write the failing test for admin authorization**

Create `src/app/actions/__tests__/dashboardActions.vault-auth.test.ts`:

```typescript
// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/auth', () => ({ getServerAuthSession: jest.fn() }));
jest.mock('@/server/utils/dev-auth', () => ({ getDevSession: jest.fn() }));
jest.mock('@/server/utils/queries/userQueries', () => ({ getUserById: jest.fn() }));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({
  getApprovedClaimByUserId: jest.fn(),
  getVaultSourceByIdAndArtist: jest.fn(),
  getVaultSourceById: jest.fn(),
  getVaultSourcesByArtistId: jest.fn(),
  updateVaultSourceStatus: jest.fn(),
  insertVaultSource: jest.fn(),
  deleteVaultSource: jest.fn(),
  deleteVaultSources: jest.fn(),
  updateVaultSourceType: jest.fn(),
  updateVaultSourceContent: jest.fn(),
  seedMockVaultSources: jest.fn(),
  getClaimByArtistId: jest.fn(),
  createClaim: jest.fn(),
  deleteClaim: jest.fn(),
  getBioVersionsByArtistId: jest.fn(),
  saveBioVersion: jest.fn(),
  pinBioVersion: jest.fn(),
  deleteBioVersion: jest.fn(),
}));
jest.mock('@/server/utils/queries/vaultWebSearch', () => ({ searchAndPopulateVault: jest.fn() }));
jest.mock('@/server/utils/queries/artistBioQuery', () => ({ generateArtistBio: jest.fn() }));
jest.mock('@/server/utils/fetchPageContent', () => ({ fetchPageContent: jest.fn() }));
jest.mock('@/server/utils/queries/discord', () => ({ sendDiscordMessage: jest.fn() }));

describe('vault action authorization', () => {
  beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

  async function setup() {
    const auth = await import('@/server/auth');
    const users = await import('@/server/utils/queries/userQueries');
    const q = await import('@/server/utils/queries/dashboardQueries');
    const actions = await import('../dashboardActions');
    (auth.getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'admin-1' } });
    return { actions, users, q };
  }

  it('lets an admin update a source they do not own', async () => {
    const { actions, users, q } = await setup();
    (users.getUserById as jest.Mock).mockResolvedValue({ id: 'admin-1', isAdmin: true });
    (q.getVaultSourceById as jest.Mock).mockResolvedValue({ id: 'src-1', artistId: 'artist-x' });
    (q.updateVaultSourceStatus as jest.Mock).mockResolvedValue({ id: 'src-1' });

    const res = await actions.updateSourceStatus('src-1', 'approved');

    expect(res.success).toBe(true);
    expect(q.updateVaultSourceStatus).toHaveBeenCalledWith('src-1', 'approved');
  });

  it('rejects a non-admin who does not own the source', async () => {
    const { actions, users, q } = await setup();
    (users.getUserById as jest.Mock).mockResolvedValue({ id: 'admin-1', isAdmin: false });
    (q.getApprovedClaimByUserId as jest.Mock).mockResolvedValue({ artistId: 'artist-owned' });
    (q.getVaultSourceByIdAndArtist as jest.Mock).mockResolvedValue(undefined);

    const res = await actions.updateSourceStatus('src-1', 'approved');

    expect(res.success).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test -- dashboardActions.vault-auth`
Expected: FAIL — admin path not implemented (`getVaultSourceById` not used; admin still rejected).

- [ ] **Step 4: Implement admin-aware authorization**

In `dashboardActions.ts`:

1. Add `getVaultSourceById` to the import from `dashboardQueries`.
2. Replace `verifySourceOwnership` with an admin-aware version:

```typescript
/** Resolve a source the user may edit: admins can edit any source, owners only their claimed artist's. Returns the source's artistId. */
async function verifySourceEditable(userId: string, sourceId: string) {
    const user = await getUserById(userId);
    if (user?.isAdmin) {
        const source = await getVaultSourceById(sourceId);
        if (!source) return { authorized: false as const, error: "Source not found" };
        return { authorized: true as const, artistId: source.artistId };
    }
    const claim = await getApprovedClaimByUserId(userId);
    if (!claim) return { authorized: false as const, error: "No claimed artist profile" };
    const source = await getVaultSourceByIdAndArtist(sourceId, claim.artistId);
    if (!source) return { authorized: false as const, error: "Source does not belong to your artist" };
    return { authorized: true as const, artistId: claim.artistId };
}
```

3. Add an artist-level helper (mirrors `resolveBioArtistId`) for the `artistId`-first actions:

```typescript
/** Authorize editing a specific artist: admins may edit any, owners only their claimed artist. */
async function verifyArtistEditable(userId: string, artistId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const user = await getUserById(userId);
    if (user?.isAdmin) return { ok: true };
    const claim = await getApprovedClaimByUserId(userId);
    if (!claim || claim.artistId !== artistId) return { ok: false, error: "Not authorized for this artist" };
    return { ok: true };
}
```

4. Update the consumers:
   - `updateSourceStatus`: use `verifySourceEditable`; use the returned `artistId` for the background bio-regen block (replace `claim.artistId`).
   - `updateSourceType`, `removeVaultSource`: use `verifySourceEditable`.
   - `addVaultSource`, `searchWebForSources`, `seedMockSources`: replace the `claim/claim.artistId !== artistId` block with `verifyArtistEditable(session.user.id, artistId)` and return its `error` on failure.
   - `removeVaultSources`: if `getUserById(userId).isAdmin`, skip the ownership filter; otherwise keep the existing claim-based ownership check.

Add `getUserById` to imports if not already present (it is, used by `resolveBioArtistId`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- dashboardActions.vault-auth`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add src/server/utils/queries/dashboardQueries.ts src/app/actions/dashboardActions.ts src/app/actions/__tests__/dashboardActions.vault-auth.test.ts
git commit -m "feat: admin-aware authorization for vault source actions"
```

---

## Task 2: Admin-aware authorization (upload routes)

**Files:**
- Modify: `src/app/api/vault/upload/route.ts`
- Modify: `src/app/api/artist/profile-image/route.ts`
- Test: `src/app/api/artist/profile-image/__tests__/route.admin.test.ts`

- [ ] **Step 1: Write the failing test (profile-image admin path)**

Create `src/app/api/artist/profile-image/__tests__/route.admin.test.ts`:

```typescript
// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/auth', () => ({ getServerAuthSession: jest.fn() }));
jest.mock('@/server/utils/dev-auth', () => ({ getDevSession: jest.fn() }));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({ getApprovedClaimByUserId: jest.fn() }));
jest.mock('@/server/utils/queries/userQueries', () => ({ getUserById: jest.fn() }));
jest.mock('@/server/lib/supabase', () => ({
  supabaseAdmin: { storage: { from: () => ({ upload: jest.fn().mockResolvedValue({ error: null }), getPublicUrl: () => ({ data: { publicUrl: 'http://x/y.png' } }) }) } },
  VAULT_BUCKET: 'vault',
}));
jest.mock('@/server/db/drizzle', () => ({ db: { update: () => ({ set: () => ({ where: jest.fn().mockResolvedValue(undefined) }) }) } }));

if (!('json' in Response)) {
  Response.json = (data, init) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }, status: init?.status || 200 });
}

describe('POST /api/artist/profile-image admin path', () => {
  beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

  it('allows an admin to upload for an artist they have not claimed', async () => {
    const auth = await import('@/server/auth');
    const users = await import('@/server/utils/queries/userQueries');
    const claims = await import('@/server/utils/queries/dashboardQueries');
    (auth.getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'admin-1' } });
    (users.getUserById as jest.Mock).mockResolvedValue({ isAdmin: true });
    (claims.getApprovedClaimByUserId as jest.Mock).mockResolvedValue(null);

    const { POST } = await import('../route');
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png', { type: 'image/png' }));
    fd.append('artistId', 'artist-x');
    const res = await POST(new Request('http://t/', { method: 'POST', body: fd }));

    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- profile-image/__tests__/route.admin`
Expected: FAIL with 403 (admin currently rejected because `getApprovedClaimByUserId` returns null).

- [ ] **Step 3: Implement admin-aware auth in both routes**

In **both** `src/app/api/artist/profile-image/route.ts` and `src/app/api/vault/upload/route.ts`, import `getUserById`:

```typescript
import { getUserById } from "@/server/utils/queries/userQueries";
```

Replace the claim/ownership block:

```typescript
        const claim = await getApprovedClaimByUserId(session.user.id);
        if (!claim) {
            return NextResponse.json({ error: "No claimed artist profile" }, { status: 403 });
        }
        // ... later ...
        if (claim.artistId !== artistId) {
            return NextResponse.json({ error: "Not authorized for this artist" }, { status: 403 });
        }
```

with (move the artistId check to after `artistId` is read from formData):

```typescript
        const user = await getUserById(session.user.id);
        const isAdmin = !!user?.isAdmin;
        const claim = isAdmin ? null : await getApprovedClaimByUserId(session.user.id);
        if (!isAdmin && !claim) {
            return NextResponse.json({ error: "No claimed artist profile" }, { status: 403 });
        }
        // ...after reading `artistId` from formData and null-checking it...
        if (!isAdmin && claim!.artistId !== artistId) {
            return NextResponse.json({ error: "Not authorized for this artist" }, { status: 403 });
        }
```

(Keep the `file`/`artistId` presence check between the two blocks, exactly where it is now.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- profile-image/__tests__/route.admin`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/vault/upload/route.ts src/app/api/artist/profile-image/route.ts "src/app/api/artist/profile-image/__tests__/route.admin.test.ts"
git commit -m "feat: allow admins to upload vault files and profile images on any artist"
```

---

## Task 3: Relocate SourceCard to the profile components

**Files:**
- Create: `src/app/artist/[id]/_components/SourceCard.tsx` (moved from dashboard)

- [ ] **Step 1: Move the file with git (preserves history)**

```bash
git mv src/app/dashboard/_components/SourceCard.tsx src/app/artist/[id]/_components/SourceCard.tsx
```

- [ ] **Step 2: Fix imports inside the moved file**

Open `src/app/artist/[id]/_components/SourceCard.tsx`. Any relative imports that pointed at sibling dashboard files must become `@/` alias imports (e.g. `@/lib/sourceTypes`, `@/server/db/DbTypes`). Type imports (`ArtistVaultSource`) should already use `@/`. Props interface is unchanged:

```typescript
interface SourceCardProps {
    source: ArtistVaultSource;
    onApprove?: (id: string) => void;
    onReject?: (id: string) => void;
    onDelete?: (id: string) => void;
    onTypeChange?: (id: string, type: string) => void;
    showActions: boolean;
    selected?: boolean;
    onSelect?: (id: string) => void;
}
```

- [ ] **Step 3: Type-check to verify the move compiles**

Run: `npm run type-check`
Expected: PASS (no references to the old path yet — dashboard still imports it; fix in Step 4).

- [ ] **Step 4: Repoint the dashboard's import (temporary, keeps build green until Task 8 deletes it)**

In `src/app/dashboard/_components/DashboardContent.tsx`, update the `SourceCard` import to `@/app/artist/[id]/_components/SourceCard`.

- [ ] **Step 5: Type-check + commit**

Run: `npm run type-check` → Expected: PASS

```bash
git add -A
git commit -m "refactor: relocate SourceCard to artist profile components"
```

---

## Task 4: VaultManager component (edit-mode vault management)

**Files:**
- Create: `src/app/artist/[id]/_components/VaultManager.tsx`
- Test: `src/__tests__/components/VaultManager.test.tsx`

**Behavior:** When `isEditing` is false → render nothing (the public approved carousel stays owned by `PressAndFeatures`). When `isEditing` is true → render: an upload control, a "Search web for sources" button, a pending-source review tray (one `SourceCard` per pending source with approve/reject/type/delete), and a list of approved sources with delete. All actions take the profile's `artistId`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/components/VaultManager.test.tsx`:

```typescript
/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VaultManager from '@/app/artist/[id]/_components/VaultManager';
import { EditModeContext } from '@/app/_components/EditModeContext';

jest.mock('@/app/actions/dashboardActions', () => ({
  updateSourceStatus: jest.fn().mockResolvedValue({ success: true }),
  updateSourceType: jest.fn().mockResolvedValue({ success: true }),
  searchWebForSources: jest.fn().mockResolvedValue({ success: true, count: 2 }),
  removeVaultSource: jest.fn().mockResolvedValue({ success: true }),
}));
import { updateSourceStatus } from '@/app/actions/dashboardActions';

const pending = [{ id: 'p1', artistId: 'a1', url: 'http://e/1', title: 'Pending One', status: 'pending' }];
const approved = [{ id: 'ap1', artistId: 'a1', url: 'http://e/2', title: 'Approved One', status: 'approved' }];

function renderEditing(isEditing = true) {
  return render(
    <EditModeContext.Provider value={{ isEditing, canEdit: true, toggle: jest.fn() }}>
      <VaultManager artistId="a1" pendingSources={pending} approvedSources={approved} />
    </EditModeContext.Provider>
  );
}

describe('VaultManager', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders nothing when not editing', () => {
    const { container } = renderEditing(false);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists pending sources and approves one', async () => {
    renderEditing(true);
    expect(screen.getByText('Pending One')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    await waitFor(() => expect(updateSourceStatus).toHaveBeenCalledWith('p1', 'approved'));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- VaultManager`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement VaultManager**

Create `src/app/artist/[id]/_components/VaultManager.tsx`. Use `DashboardContent.tsx` as the reference for the handlers (optimistic update patterns, toast usage) but drive every action with the `artistId` prop:

```tsx
"use client";

import { useContext, useState, useRef } from "react";
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
    } else {
      toast({ title: "Couldn't approve source", description: res.error, variant: "destructive" });
    }
  }

  async function handleReject(id: string) {
    const res = await updateSourceStatus(id, "rejected");
    if (res.success) setPending(prev => prev.filter(s => s.id !== id));
    else toast({ title: "Couldn't reject source", description: res.error, variant: "destructive" });
  }

  async function handleDelete(id: string) {
    const res = await removeVaultSource(id);
    if (res.success) {
      setPending(prev => prev.filter(s => s.id !== id));
      setApproved(prev => prev.filter(s => s.id !== id));
    } else {
      toast({ title: "Couldn't delete source", description: res.error, variant: "destructive" });
    }
  }

  async function handleTypeChange(id: string, type: string) {
    const res = await updateSourceType(id, type);
    if (!res.success) toast({ title: "Couldn't update type", description: res.error, variant: "destructive" });
    else {
      setPending(prev => prev.map(s => s.id === id ? { ...s, type } : s));
      setApproved(prev => prev.map(s => s.id === id ? { ...s, type } : s));
    }
  }

  async function handleWebSearch() {
    setSearching(true);
    try {
      const res = await searchWebForSources(artistId);
      if (res.success) toast({ title: `Found ${res.count ?? 0} source(s)`, description: "Refresh to review them." });
      else toast({ title: "Search failed", description: res.error, variant: "destructive" });
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
        setPending(prev => [data.source, ...prev]);
        toast({ title: "File uploaded" });
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
        <input ref={fileRef} type="file" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }} />
        <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? "Uploading…" : "Upload file"}
        </Button>
        <Button size="sm" variant="outline" disabled={searching} onClick={handleWebSearch}>
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
            <SourceCard key={s.id} source={s} showActions
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
```

Import `updateSourceType` in the action import block (added above). If `SourceCard`'s approve button label isn't "Approve", adjust the test's `name: /approve/i` to match, or add an `aria-label="Approve"` to the button in `SourceCard.tsx`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- VaultManager`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/artist/[id]/_components/VaultManager.tsx" "src/__tests__/components/VaultManager.test.tsx"
git commit -m "feat: VaultManager edit-mode component for the artist profile"
```

---

## Task 5: BioVersionHistory component (edit-mode bio versions)

**Files:**
- Create: `src/app/artist/[id]/_components/BioVersionHistory.tsx`
- Test: `src/__tests__/components/BioVersionHistory.test.tsx`

**Behavior:** Edit-mode-only collapsible list of bio versions. Loads via `getArtistBioVersions(artistId)`, pins via `pinBioVersionAction(versionId, artistId)`, deletes via `deleteBioVersionAction(versionId, artistId)`. All calls pass the profile's `artistId` so admins can manage other artists' versions.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/components/BioVersionHistory.test.tsx`:

```typescript
/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BioVersionHistory from '@/app/artist/[id]/_components/BioVersionHistory';
import { EditModeContext } from '@/app/_components/EditModeContext';

jest.mock('@/app/actions/dashboardActions', () => ({
  getArtistBioVersions: jest.fn().mockResolvedValue({
    success: true,
    versions: [
      { id: 'v1', artistId: 'a1', bioText: 'First bio', isPinned: true, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'v2', artistId: 'a1', bioText: 'Second bio', isPinned: false, createdAt: '2026-02-01T00:00:00Z' },
    ],
  }),
  pinBioVersionAction: jest.fn().mockResolvedValue({ success: true }),
  deleteBioVersionAction: jest.fn().mockResolvedValue({ success: true }),
}));
import { pinBioVersionAction } from '@/app/actions/dashboardActions';

function renderEditing(isEditing = true) {
  return render(
    <EditModeContext.Provider value={{ isEditing, canEdit: true, toggle: jest.fn() }}>
      <BioVersionHistory artistId="a1" />
    </EditModeContext.Provider>
  );
}

describe('BioVersionHistory', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders nothing when not editing', () => {
    const { container } = renderEditing(false);
    expect(container).toBeEmptyDOMElement();
  });

  it('loads versions and pins one with the artistId', async () => {
    renderEditing(true);
    await waitFor(() => expect(screen.getByText('Second bio')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: /pin/i })[0]);
    await waitFor(() => expect(pinBioVersionAction).toHaveBeenCalledWith('v2', 'a1'));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- BioVersionHistory`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement BioVersionHistory**

Create `src/app/artist/[id]/_components/BioVersionHistory.tsx`, using `BioVersionsSection.tsx` as the reference but passing `artistId` to every action:

```tsx
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
      .then(res => { if (active && res.success && res.versions) setVersions(res.versions as BioVersion[]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [isEditing, artistId]);

  if (!isEditing) return null;

  async function handlePin(id: string) {
    const res = await pinBioVersionAction(id, artistId);
    if (res.success) setVersions(prev => prev.map(v => ({ ...v, isPinned: v.id === id })));
    else toast({ title: "Couldn't pin version", description: res.error, variant: "destructive" });
  }

  async function handleDelete(id: string) {
    const res = await deleteBioVersionAction(id, artistId);
    if (res.success) setVersions(prev => prev.filter(v => v.id !== id));
    else toast({ title: "Couldn't delete version", description: res.error, variant: "destructive" });
  }

  return (
    <div className="space-y-2">
      <button onClick={() => setOpen(o => !o)} className="text-xs text-muted-foreground hover:text-pastypink">
        {open ? "Hide" : "Show"} version history ({versions.length})
      </button>
      {open && (
        <div className="space-y-2">
          {loading && <p className="text-xs text-muted-foreground italic">Loading versions…</p>}
          {!loading && versions.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No saved versions yet.</p>
          )}
          {versions.map(v => (
            <div key={v.id} className="glass-subtle p-2 flex items-start justify-between gap-2">
              <p className="text-xs text-black dark:text-white line-clamp-3">{v.bioText}</p>
              <div className="flex items-center gap-1 shrink-0">
                <Button size="sm" variant="ghost" aria-label="Pin" disabled={v.isPinned} onClick={() => handlePin(v.id)}>
                  <Pin size={13} className={v.isPinned ? "text-pastypink" : ""} />
                </Button>
                <Button size="sm" variant="ghost" aria-label="Delete" disabled={v.isPinned} onClick={() => handleDelete(v.id)}>
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- BioVersionHistory`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/artist/[id]/_components/BioVersionHistory.tsx" "src/__tests__/components/BioVersionHistory.test.tsx"
git commit -m "feat: BioVersionHistory edit-mode component for the artist profile"
```

---

## Task 6: Profile-image upload overlay in HeroSection

**Files:**
- Modify: `src/app/artist/[id]/_components/HeroSection.tsx`
- Test: `src/__tests__/components/HeroSection.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/components/HeroSection.test.tsx`:

```typescript
/// <reference types="@testing-library/jest-dom" />
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import HeroSection from '@/app/artist/[id]/_components/HeroSection';
import { EditModeContext } from '@/app/_components/EditModeContext';

function renderWith(isEditing: boolean) {
  return render(
    <EditModeContext.Provider value={{ isEditing, canEdit: true, toggle: jest.fn() }}>
      <HeroSection imageUrl="/x.png" artistName="Test" artistId="a1" />
    </EditModeContext.Provider>
  );
}

describe('HeroSection image upload overlay', () => {
  it('shows the change-photo control in edit mode', () => {
    renderWith(true);
    expect(screen.getByLabelText(/change photo/i)).toBeInTheDocument();
  });

  it('hides the control when not editing', () => {
    renderWith(false);
    expect(screen.queryByLabelText(/change photo/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- HeroSection`
Expected: FAIL — `artistId` prop not accepted / control absent.

- [ ] **Step 3: Implement the overlay**

In `HeroSection.tsx`: add `artistId: string` to the props interface. Read edit state: `const { isEditing } = useContext(EditModeContext);` (add `"use client"` at the top if not present, plus the React/context imports). Inside the image container `motion.div`, add an edit-mode overlay:

```tsx
{isEditing && (
  <>
    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
      onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); e.target.value = ""; }} />
    <button type="button" aria-label="Change photo" onClick={() => fileRef.current?.click()}
      className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white text-xs opacity-0 hover:opacity-100 transition-opacity">
      {uploading ? "Uploading…" : "Change photo"}
    </button>
  </>
)}
```

Add the handler (mirror DashboardContent's image upload), updating the displayed image on success via local state seeded from the `imageUrl` prop:

```tsx
async function handleImageUpload(file: File) {
  setUploading(true);
  try {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("artistId", artistId);
    const res = await fetch("/api/artist/profile-image", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.imagePath) { setImg(data.imagePath); toast({ title: "Photo updated" }); }
    else toast({ title: "Couldn't update photo", description: data.error || "Upload failed", variant: "destructive" });
  } catch {
    toast({ title: "Couldn't update photo", description: "Network error", variant: "destructive" });
  } finally { setUploading(false); }
}
```

Add `const [img, setImg] = useState(imageUrl);`, `const [uploading, setUploading] = useState(false);`, `const fileRef = useRef<HTMLInputElement>(null);`, `const { toast } = useToast();`, and render the `<Image>`/`<img>` from `img` instead of the raw prop. Ensure the container has `relative` positioning so the absolute overlay anchors correctly.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- HeroSection`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/artist/[id]/_components/HeroSection.tsx" "src/__tests__/components/HeroSection.test.tsx"
git commit -m "feat: edit-mode profile-image upload overlay on HeroSection"
```

---

## Task 7: Wire the profile page

**Files:**
- Modify: `src/app/artist/[id]/page.tsx`
- Modify: `src/app/artist/[id]/_components/BlurbSection.tsx`
- Test: `src/__tests__/ArtistPage.test.tsx` (extend existing)

- [ ] **Step 1: Mount BioVersionHistory inside BlurbSection (edit mode)**

In `BlurbSection.tsx`, import the component and render it within the edit-mode branch (the `if (isEditing) { return (...) }` block), below the buttons row:

```tsx
import BioVersionHistory from "./BioVersionHistory";
// ...inside the isEditing return, after the </div> closing the buttons row:
<BioVersionHistory artistId={artistId} />
```

- [ ] **Step 2: Add owner-only fetches and render VaultManager in page.tsx**

In `page.tsx`:

1. Import the new components and the pending/bio queries:

```tsx
import VaultManager from "./_components/VaultManager";
import { getBioVersionsByArtistId } from "@/server/utils/queries/dashboardQueries";
```

2. After computing `canEdit`, fetch owner-only data in parallel only when needed:

```tsx
const pendingSources = canEdit ? await getVaultSourcesByArtistId(id, "pending") : [];
```

(`approvedSources` is already fetched. Bio versions are loaded client-side by `BioVersionHistory`, so no server fetch is required for them — do not add one.)

3. Pass `artistId` to `HeroSection`:

```tsx
<HeroSection imageUrl={imageUrl} artistName={artist.name ?? "Artist"} artistId={artist.id} />
```

4. Replace the conditional Vault section (currently `approvedSources.length > 0`) so it renders when `canEdit` OR there are approved sources. Keep `PressAndFeatures` for the public/approved display and add `VaultManager` for editing:

```tsx
{(canEdit || approvedSources.length > 0) && (
  <RevealSection className="glass p-4 sm:p-5 space-y-3">
    <h2 className="text-black dark:text-white text-xl font-bold">Artist Vault</h2>
    {approvedSources.length > 0 && <PressAndFeatures sources={approvedSources} />}
    {canEdit && (
      <VaultManager artistId={artist.id} pendingSources={pendingSources} approvedSources={approvedSources} />
    )}
  </RevealSection>
)}
```

- [ ] **Step 3: Extend the ArtistPage test for owner surfaces**

`src/__tests__/ArtistPage.test.tsx` mocks every profile child and the data layer (`getServerAuthSession`, `getUserById` → `isAdmin:false`, `getClaimByArtistId` → null, `getVaultSourcesByArtistId` → `[]`). The new `VaultManager` child must be mocked too, and the test makes the viewer an admin so `canEdit` is true with zero approved sources.

First add a `VaultManager` mock alongside the other component mocks near the top of the file:

```typescript
jest.mock('@/app/artist/[id]/_components/VaultManager', () => function VaultManager() { return <div data-testid="vault-manager" />; });
```

Then add this test (it imports the already-mocked `getServerAuthSession` and `getUserById`):

```typescript
it('renders the Vault section for an editor even with no approved sources', async () => {
  const { getUserById } = await import('@/server/utils/queries/userQueries');
  (getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'admin-uuid' } });
  (getUserById as jest.Mock).mockResolvedValue({ id: 'admin-uuid', isAdmin: true, isWhiteListed: false });
  (getArtistById as jest.Mock).mockResolvedValue(mockArtist);
  (getAllLinks as jest.Mock).mockResolvedValue([]);
  (musicPlatformData.getArtist as jest.Mock).mockResolvedValue({ imageUrl: 'x.jpg' });

  const ui = await ArtistProfile({ params: Promise.resolve({ id: 'artist-uuid' }) });
  render(ui);

  expect(screen.getByText('Artist Vault')).toBeInTheDocument();
  expect(screen.getByTestId('vault-manager')).toBeInTheDocument();
});
```

(Match the exact render/await pattern the existing tests in this file already use — some call `await ArtistProfile(...)` then `render`. Copy whichever the neighbouring tests use.)

- [ ] **Step 4: Run the profile tests**

Run: `npm run test -- ArtistPage BlurbSection`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/artist/[id]/page.tsx" "src/app/artist/[id]/_components/BlurbSection.tsx" "src/__tests__/ArtistPage.test.tsx"
git commit -m "feat: surface vault management and bio history on the artist profile in edit mode"
```

---

## Task 8: Nav owner-link to the claimed profile

**Files:**
- Modify: `src/app/api/user/has-claim/route.ts`
- Modify: `src/app/_components/nav/components/PrivyLogin.tsx`
- Modify: `src/app/_components/nav/components/Login.tsx`
- Test: `src/app/api/user/has-claim/__tests__/route.test.ts`

**Behavior:** The authenticated user dropdown in `PrivyLogin` already shows a "Dashboard" item gated on a `/api/user/has-claim` fetch. Repoint it at the user's claimed artist profile. To do that the endpoint must also return the claimed `artistId`. The dev-only `/dashboard` icon in `Login.tsx`'s `NoWalletLogin` (CI/no-Privy fallback, no session) is simply removed.

- [ ] **Step 1: Write the failing test for the endpoint's new field**

Create `src/app/api/user/has-claim/__tests__/route.test.ts`:

```typescript
// @ts-nocheck
import { jest } from '@jest/globals';

jest.mock('@/server/auth', () => ({ getServerAuthSession: jest.fn() }));
jest.mock('@/server/utils/queries/dashboardQueries', () => ({ getApprovedClaimByUserId: jest.fn() }));

if (!('json' in Response)) {
  Response.json = (data, init) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }, status: init?.status || 200 });
}

describe('GET /api/user/has-claim', () => {
  beforeEach(() => { jest.resetModules(); jest.clearAllMocks(); });

  it('returns the claimed artistId when a claim exists', async () => {
    const { getServerAuthSession } = await import('@/server/auth');
    const { getApprovedClaimByUserId } = await import('@/server/utils/queries/dashboardQueries');
    (getServerAuthSession as jest.Mock).mockResolvedValue({ user: { id: 'u1' } });
    (getApprovedClaimByUserId as jest.Mock).mockResolvedValue({ id: 'c1', artistId: 'artist-9' });

    const { GET } = await import('../route');
    const data = await (await GET()).json();

    expect(data).toEqual({ hasClaim: true, artistId: 'artist-9' });
  });

  it('returns hasClaim false and null artistId when unauthenticated', async () => {
    const { getServerAuthSession } = await import('@/server/auth');
    (getServerAuthSession as jest.Mock).mockResolvedValue(null);

    const { GET } = await import('../route');
    const data = await (await GET()).json();

    expect(data).toEqual({ hasClaim: false, artistId: null });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- has-claim`
Expected: FAIL — response has no `artistId` field.

- [ ] **Step 3: Add artistId to the endpoint**

In `src/app/api/user/has-claim/route.ts`, return the claimed artistId:

```typescript
        if (!session?.user?.id) {
            return Response.json({ hasClaim: false, artistId: null });
        }

        const claim = await getApprovedClaimByUserId(session.user.id);
        return Response.json({ hasClaim: !!claim, artistId: claim?.artistId ?? null });
```

And update the `catch` to `return Response.json({ hasClaim: false, artistId: null });`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- has-claim`
Expected: PASS.

- [ ] **Step 5: Repoint the PrivyLogin dropdown item**

In `PrivyLogin.tsx`:

1. Add a `claimedArtistId` state next to `hasDashboardClaim`:

```typescript
const [claimedArtistId, setClaimedArtistId] = useState<string | null>(null);
```

2. In the `has-claim` effect, also store the artistId:

```typescript
        .then(d => { setHasDashboardClaim(!!d.hasClaim); setClaimedArtistId(d.artistId ?? null); })
        .catch(() => { setHasDashboardClaim(false); setClaimedArtistId(null); })
```

(reset both to false/null in the early `if (!session)` branch too.)

3. Replace the dashboard dropdown item (the `{hasDashboardClaim && (...)}` block) with:

```tsx
{hasDashboardClaim && claimedArtistId && (
  <DropdownMenuItem asChild>
    <Link href={`/artist/${claimedArtistId}`} prefetch>
      My Artist Profile
    </Link>
  </DropdownMenuItem>
)}
```

- [ ] **Step 6: Remove the dev-only dashboard icon in Login.tsx**

In `Login.tsx`'s `NoWalletLogin`, delete the `<Link href="/dashboard" …>` element (and its `LayoutDashboard` import if now unused). Keep the `/admin` link.

- [ ] **Step 7: Type-check and confirm no /dashboard references remain in nav**

Run: `npm run type-check && grep -rn "/dashboard" src/app/_components/nav`
Expected: type-check PASS; grep returns nothing.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/user/has-claim/route.ts "src/app/api/user/has-claim/__tests__/route.test.ts" src/app/_components/nav/components/Login.tsx src/app/_components/nav/components/PrivyLogin.tsx
git commit -m "feat: nav links owners to their claimed artist profile instead of /dashboard"
```

---

## Task 9: Delete the dashboard route and redundant components

**Files:**
- Delete: `src/app/dashboard/` (entire directory)

- [ ] **Step 1: Confirm nothing still imports the dashboard components or links to /dashboard**

Run: `grep -rn "/dashboard\|dashboard/_components\|DashboardContent\|BioVersionsSection\|DashboardLinksSection" src --include="*.ts" --include="*.tsx"`
Expected: only matches inside `src/app/dashboard/` itself (which we're deleting) and unrelated substrings like `getArtistDashboardData`. If anything else references them, fix it before deleting.

Note: `getArtistDashboardData` in `dashboardActions.ts` becomes unused after deletion. Remove that exported action too (and its now-unused imports) if grep shows no other consumer.

- [ ] **Step 2: Delete the directory**

```bash
git rm -r src/app/dashboard
```

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: PASS (no dangling imports).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove the standalone dashboard route and components"
```

---

## Task 10: Full verification

- [ ] **Step 1: Run the whole gate**

Ensure `.env.local` exists (stub per CLAUDE.md if missing), then:

Run: `npm run type-check && npm run lint && npm run test && npm run build`
Expected: all pass. Fix any failures before proceeding.

- [ ] **Step 2: Manual smoke (document, do not skip)**

With `npm run dev`, verify as an owner of a claimed artist:
- Profile shows EditMode toggle; entering edit mode reveals the upload control, web-search button, pending tray, approved list, bio version history, and the change-photo overlay.
- Upload a PDF → appears in pending. Approve it → moves to approved. Delete works.
- Pin a bio version → it becomes active; deleting the pinned version is blocked.
- As an admin on a *different* artist's profile: the same vault/image controls work (this is what Tasks 1–2 enable).
- Nav owner-link routes to the claimed profile; a user with no claim sees no owner-link and `/dashboard` 404s.

- [ ] **Step 3: Final commit (if any verification fixes were made)**

```bash
git add -A
git commit -m "chore: verification fixes for dashboard-into-profile migration"
```

---

## Self-review notes

- **Spec coverage:** vault management (Tasks 1,2,4,7), pending review (Task 4), bio version history (Task 5), profile-image upload (Tasks 2,6), claim flow (unchanged — already on profile, no task needed), nav (Task 8), deletion (Task 9), tests (each task), keep queries/actions layer (kept; only extended). Link management intentionally has no task — already covered on the profile.
- **Scope addition beyond spec:** admin-aware authorization for vault + image (Tasks 1–2). Required because `canEdit` includes admins and the dashboard only ever operated on the user's own claim. Mirrors the existing `resolveBioArtistId` admin pattern.
- **Type consistency:** action names used in components match `dashboardActions.ts` exports (`updateSourceStatus`, `updateSourceType`, `removeVaultSource`, `searchWebForSources`, `getArtistBioVersions`, `pinBioVersionAction`, `deleteBioVersionAction`). `SourceCard` props match its interface. `VaultManager`/`BioVersionHistory` take `artistId` and pass it through.
- **Risk:** `SourceCard`'s exact button labels are assumed; Task 4 Step 3 notes adjusting the test or adding `aria-label`s if they differ — verify against the relocated file.
