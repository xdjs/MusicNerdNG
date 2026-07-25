# Add Subvert as a support-link platform

**Date:** 2026-07-24
**Status:** Approved — build + apply to prod

## Problem

Users can't add `subvert.fm` links to artist profiles (e.g. `https://www.subvert.fm/pete-rango`). Submitting one returns "link not supported" because `extractArtistId` finds no `urlmap` row whose regex matches, and there is no `subvert` column to store it in.

## How platforms work (context)

Each platform is (a) a column on the `artists` table, (b) a `urlmap` row whose `site_name` equals that column and whose `regex` extracts the artist's ID/slug, and (c) registered in a few code lists. `ArtistLinksGrid` shows a link in the **"Support the Artist"** group when `urlmap.is_monetized` is true or the `site_name` is in `FORCE_SUPPORT_PLATFORMS`. Icons render via a plain `<img src={siteImage}>`, so a local `/siteIcons/*` path works (Spotify/Deezer already do this).

## Design (mirrors the Bandcamp platform)

### Code changes
1. `public/siteIcons/subvert_icon.jpg` — the provided logo.
2. `src/server/db/schema.ts` — add `subvert: text()` to `artists`.
3. Drizzle migration (`db:generate`) — `ALTER TABLE artists ADD COLUMN subvert text;` (nullable, no backfill).
4. `src/server/utils/artistLinkService.ts` — add `"subvert"` to `WRITABLE_LINK_COLUMNS`.
5. `src/app/_components/ArtistLinksGrid.tsx` — add `"subvert"` to `FORCE_SUPPORT_PLATFORMS`.
6. `src/app/api/searchArtists/route.ts` — add `"subvert"` to `LINK_FIELDS` (content-count accuracy).
7. `src/server/utils/queries/artistDataQueries.ts` — add `{ column: "subvert", category: "listen" }` to `TRACKED_COLUMNS` (admin stats).

### Production DB writes
8. Apply the column migration to prod.
9. Insert the `urlmap` row (recorded reproducibly in `drizzle/seed/subvert_urlmap.sql` — idempotent, re-runnable on any environment):
   - `site_name` = `subvert`, `site_url` = `subvert.fm`
   - `example` = `https://www.subvert.fm/ARTIST_NAME`
   - `app_string_format` = `https://www.subvert.fm/%@`
   - `regex` = `^https?://(?:www\.)?subvert\.fm/([^/?#]+)`
   - `platform_type_list` = `{listen}`, `is_monetized` = `true`, `is_web3_site` = `false`
   - `card_platform_name` = `Subvert`, `card_description` = `Support their work on %@`
   - `site_image` = `/siteIcons/subvert_icon.jpg`
   - `color_hex` = `#1A1A1A` (logo is white-on-near-black)
   - `is_iframe_enabled` = `false`, `is_embed_enabled` = `false`, `order` = next available

## Assumptions

- Subvert artist URLs are the bare-slug form (`subvert.fm/<name>`), matching the reported URL. If `/artist/...` or `/@name` forms exist, widen the regex later.
- No `validateLink` (liveness) entry — subvert is not in `AddArtistData`'s `backendPlatforms`, so links are accepted on regex match, which is intended.

## Testing / verification

- Unit: add a `services.test.ts` case asserting `extractArtistId` resolves a subvert URL to `{ siteName: "subvert", id: "pete-rango" }` (mocked urlmap row).
- Functional (post-apply): confirm `extractArtistId("https://www.subvert.fm/pete-rango")` against prod, then add the link to the reporting artist and confirm it renders in the support grid.
- `npm run type-check && lint && test && build`.

## Out of scope

- A dedicated liveness/`validateLink` check for subvert.
- Wider subvert URL shapes beyond the bare slug.
