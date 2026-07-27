# Add Bluesky as an approved social-link platform

**Date:** 2026-07-27
**Status:** Approved — build + apply to prod

## Problem

Users can't add Bluesky links (`https://bsky.app/profile/<handle>`) to artist profiles — there's no `urlmap` row or column, so `extractArtistId` returns "not supported". Requested by the team.

## Design (mirrors the Subvert platform; Bluesky is **social**, not support)

Same "platform = column + urlmap row + code lists" pattern as Subvert, with the social-platform differences: `platform_type_list = {social}`, `is_monetized = false`, and **not** added to `FORCE_SUPPORT_PLATFORMS` (it renders in the "Social Links" grid, not "Support the Artist").

### Code changes
1. `public/siteIcons/bluesky_icon.png` — Bluesky butterfly (fetched from bsky.app apple-touch-icon, 180×180 RGBA).
2. `src/server/db/schema.ts` — add `bluesky: text()` to `artists`.
3. Drizzle migration — `ALTER TABLE artists ADD COLUMN IF NOT EXISTS bluesky text;` (idempotent; column applied to prod ahead of merge, same as Subvert).
4. `src/server/utils/artistLinkService.ts` — add `"bluesky"` to `WRITABLE_LINK_COLUMNS`.
5. `src/app/api/searchArtists/route.ts` — add `"bluesky"` to `LINK_FIELDS`.
6. `src/server/utils/queries/artistDataQueries.ts` — add `{ column: "bluesky", category: "social" }` to `TRACKED_COLUMNS`.
7. `drizzle/seed/bluesky_urlmap.sql` — reproducible, idempotent urlmap seed.

### Production DB writes (via Supabase CLI `--linked`)
8. `ALTER TABLE artists ADD COLUMN IF NOT EXISTS bluesky text;`
9. Insert `urlmap` row:
   - `site_name` = `bluesky`, `site_url` = `bsky.app`
   - `example` = `https://bsky.app/profile/ARTIST_HANDLE`
   - `app_string_format` = `https://bsky.app/profile/%@`
   - `regex` = `^https?://(?:www\.)?bsky\.app/profile/([^/?#]+)`
   - `platform_type_list` = `{social}`, `is_monetized` = `false`, `is_web3_site` = `false`
   - `card_platform_name` = `Bluesky`, `card_description` = `Follow them on %@`
   - `site_image` = `/siteIcons/bluesky_icon.png`
   - `color_hex` = `#1185FE` (Bluesky brand blue)

### Tests
- `extractArtistId` resolves `https://bsky.app/profile/<handle>` (www + non-www) to `{ siteName: "bluesky", id: "<handle>" }`.
- Full-`Artist` test fixtures updated with `bluesky: null`.

## Assumptions

- Intake URLs are the standard profile form `bsky.app/profile/<handle>`; the handle (`x.bsky.social`, a custom domain, or a DID) is stored verbatim.
- No `validateLink` liveness entry (accepted on regex match, consistent with other newly-added platforms).

## Out of scope

- Other Bluesky URL shapes (post URLs, starter packs, etc.).
- Bio-relevance (`BIO_RELEVANT_COLUMNS`) — Bluesky isn't a primary music-data source; left out like facebook/tiktok.
