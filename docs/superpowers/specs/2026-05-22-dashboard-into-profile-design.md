# Design: Fold the artist dashboard into the artist profile page

**Date:** 2026-05-22
**Branch:** `peterarango/profile-edit-mode`
**Status:** Approved design — ready for implementation plan

## Problem

The artist "dashboard" (`/dashboard`) is a separate page that doesn't carry
enough weight to justify its own route. All of its edit and vault capabilities
should live on the artist profile page (`/artist/[id]`) for users who have
permission to edit that profile. After this change there is no artist dashboard;
its capabilities are inline edit-mode surfaces on the profile.

## End state & model

The `/dashboard` route and all of its components are **removed**. Every owner
capability becomes an **inline edit-mode surface** on `/artist/[id]`, gated by
the existing permission check and edit-mode infrastructure:

- `canEdit = isClaimedByUser || isAdmin` (already computed in `page.tsx:94`)
- `EditModeProvider` / `EditModeToggle` (already wrapping the profile)

No new routes, no drawer, no tabs. A non-owner — including a logged-in user with
no claim — sees the normal public profile with no edit affordances, exactly as
today. There is **no onboarding/landing/`/claim` surface**: claiming already
works via `ClaimButton` on any artist profile.

### Already on the profile — no work needed

These capabilities already exist on `/artist/[id]` and are reused as-is:

- Claim + pending-verification flow with reference code — `ClaimButton.tsx`
- Bio edit / regenerate / save / save-to-version — `BlurbSection.tsx`
- Social & support link add/remove — `AddArtistData.tsx` + `ArtistLinksGrid.tsx`
- Approved-vault display (read-only carousel) — `PressAndFeatures.tsx`

### Unique to the dashboard — must migrate inline

1. **Vault management.** Upload, "search web for sources", a **pending-source
   review tray** (approve / reject / tag type / delete / bulk delete), and type
   filtering. The profile today shows *approved sources only*, read-only.
2. **Bio version history.** The list of past bio versions with pin (set active)
   and delete. `BlurbSection` can *save* a version but has no history browser.
3. **Profile-image upload.** `HeroSection` only displays the image today.

## Profile page changes (`src/app/artist/[id]/`)

### Vault section becomes owner-aware

- Today the Vault section renders only when `approvedSources.length > 0`
  (`page.tsx:182`). Change: render the section whenever `canEdit` **OR** there
  are approved sources.
- In edit mode the section gains, above the approved carousel:
  - An **upload zone** (wired to `POST /api/vault/upload`).
  - A **"Search web for sources"** button (wired to the existing
    `searchWebForSources` server action).
  - A **pending review tray** listing pending sources, each with approve /
    reject / tag-type / delete controls and bulk delete — built from the
    relocated `SourceCard` component.
- **Empty state:** when an owner has zero approved and zero pending sources, the
  section still renders in edit mode with an upload affordance + explanatory
  empty state.

### Bio version history

- Add a collapsible **"Version history"** affordance to `BlurbSection` (or a
  sibling component rendered alongside it), visible only in edit mode.
- Lists bio versions with **pin** (sets the active bio) and **delete** (blocked
  for the pinned version). Reuses existing `dashboardQueries` bio-version
  functions (`getBioVersionsByArtistId`, `pinBioVersion`, `deleteBioVersion`).

### Profile image upload

- `HeroSection` gains an edit-mode overlay (upload button) wired to the existing
  `POST /api/artist/profile-image`.

### Server-side fetches

- `page.tsx` adds, **only when `canEdit`**:
  - a `pending` vault-sources fetch (`getVaultSourcesByArtistId(id, "pending")`),
  - a bio-versions fetch (`getBioVersionsByArtistId(id)`).
- These are extra queries only on edit-mode loads; public loads are unchanged.

## Removal, nav, and tests

### Delete

- `src/app/dashboard/` entirely:
  - `page.tsx`
  - `_components/DashboardContent.tsx`
  - `_components/BioVersionsSection.tsx`
  - `_components/DashboardLinksSection.tsx`
- `_components/SourceCard.tsx` is **relocated** to
  `src/app/artist/[id]/_components/` (the pending tray reuses it), not deleted.

### Keep

- `src/server/utils/queries/dashboardQueries.ts` and
  `src/app/actions/dashboardActions.ts` — shared data/action layer, now consumed
  by the profile page. A later rename (e.g. away from the "dashboard" name) is
  out of scope for this migration.

### Nav

- Replace the dev-only `/dashboard` icon in
  `src/app/_components/nav/components/Login.tsx` with an **owner-link** to the
  user's claimed artist profile. It is **hidden when the user has no approved
  claim**. (Requires fetching the user's approved claim for the nav — use
  `getApprovedClaimByUserId`.)

### Tests

- Inventory `src/app/dashboard/__tests__/` and any vault/bio tests. **Move**
  their assertions to profile-page / vault-section / bio-version tests rather
  than deleting coverage.
- Add new tests for: the edit-mode vault tray (pending review actions), the bio
  version-history list (pin/delete), and the profile-page conditional rendering
  of owner surfaces (`canEdit` true vs false).

## Out of scope

- Renaming `dashboardQueries` / `dashboardActions`.
- Multi-artist ownership (the model remains one approved claim per user).
- Any change to the claim verification mechanism itself.

## Risks / notes

- `page.tsx` grows; keep the new surfaces as well-bounded child components
  (`VaultManager`, `BioVersionHistory`, image-upload overlay) so the page stays
  readable and each unit is independently testable.
- Edit-mode loads do extra DB work (pending sources + bio versions). Acceptable
  because it only affects owners/admins viewing their own profile.
- Confirm nothing else links to `/dashboard` before deleting the route
  (search the codebase for `"/dashboard"`).
