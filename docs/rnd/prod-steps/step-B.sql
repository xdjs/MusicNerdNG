-- STEP B — 0017 then 0019: index builds on the live artists table.
-- These take a lock that blocks writes to artists while building.
-- Run as its own step, not bundled with anything else.
-- ==============================================================
BEGIN;

-- ---- 0017_artist_handle_lookup_indexes.sql ----
-- Cross-artist handle collision checks were sequential scans.
--
-- `handleBelongsToAnotherArtist` in vaultWebSearch.ts asks "is this handle
-- already assigned to a DIFFERENT artist in the directory" before adopting a
-- candidate. Three artists here are called Black Dave, so the check is what
-- stops one of them inheriting another's accounts.
--
-- It runs `lower(<platform>) = lower(<handle>)`, and a plain index on the column
-- cannot serve `lower(column)` — so every call scanned all ~42,000 rows.
-- Measured at 266ms per call on dev, and the propagation pass calls it once per
-- candidate handle per platform (up to ~50 calls), which is ten-plus seconds
-- against a 45s discovery budget.
--
-- These are FUNCTIONAL indexes on lower(column), matching the query exactly.
-- No RLS policies are needed: an index changes no grants and creates no table.
-- Plain CREATE INDEX rather than CONCURRENTLY because Drizzle runs migrations
-- inside a transaction (CONCURRENTLY cannot) and 42k rows builds in well under
-- a second.
CREATE INDEX IF NOT EXISTS artists_lower_instagram_idx      ON artists (lower(instagram));
CREATE INDEX IF NOT EXISTS artists_lower_x_idx              ON artists (lower(x));
CREATE INDEX IF NOT EXISTS artists_lower_tiktok_idx         ON artists (lower(tiktok));
CREATE INDEX IF NOT EXISTS artists_lower_youtube_idx        ON artists (lower(youtube));
CREATE INDEX IF NOT EXISTS artists_lower_youtubechannel_idx ON artists (lower(youtubechannel));
CREATE INDEX IF NOT EXISTS artists_lower_soundcloud_idx     ON artists (lower(soundcloud));
CREATE INDEX IF NOT EXISTS artists_lower_bandcamp_idx       ON artists (lower(bandcamp));
CREATE INDEX IF NOT EXISTS artists_lower_twitch_idx         ON artists (lower(twitch));
CREATE INDEX IF NOT EXISTS artists_lower_facebook_idx       ON artists (lower(facebook));
CREATE INDEX IF NOT EXISTS artists_lower_spotify_idx        ON artists (lower(spotify));
CREATE INDEX IF NOT EXISTS artists_lower_deezer_idx         ON artists (lower(deezer));

-- ---- 0019_handle_indexes_match_the_query.sql ----
-- The indexes from 0017 stopped matching the query they were built for.
--
-- 0017 created indexes on `lower(<platform>)`. A later fix made the collision
-- check compare `lower(ltrim(<platform>, '@'))`, because some rows store the
-- legacy "@handle" form and comparing that against a normalized candidate
-- reported a claimed handle as free. Postgres cannot serve the new expression
-- from the old index, so every ownership check went back to scanning all
-- ~42,000 artists — and the propagation path runs it dozens of times inside a
-- 45-second budget.
--
-- Indexes on the exact expression the query uses. The 0017 indexes are dropped
-- rather than left behind: nothing queries `lower(<platform>)` on its own, and
-- an unused index still costs on every write.
DROP INDEX IF EXISTS artists_lower_instagram_idx;
DROP INDEX IF EXISTS artists_lower_x_idx;
DROP INDEX IF EXISTS artists_lower_tiktok_idx;
DROP INDEX IF EXISTS artists_lower_youtube_idx;
DROP INDEX IF EXISTS artists_lower_youtubechannel_idx;
DROP INDEX IF EXISTS artists_lower_soundcloud_idx;
DROP INDEX IF EXISTS artists_lower_bandcamp_idx;
DROP INDEX IF EXISTS artists_lower_twitch_idx;
DROP INDEX IF EXISTS artists_lower_facebook_idx;
DROP INDEX IF EXISTS artists_lower_spotify_idx;
DROP INDEX IF EXISTS artists_lower_deezer_idx;
CREATE INDEX IF NOT EXISTS artists_handle_instagram_idx      ON artists (lower(ltrim(instagram, '@')));
CREATE INDEX IF NOT EXISTS artists_handle_x_idx              ON artists (lower(ltrim(x, '@')));
CREATE INDEX IF NOT EXISTS artists_handle_tiktok_idx         ON artists (lower(ltrim(tiktok, '@')));
CREATE INDEX IF NOT EXISTS artists_handle_youtube_idx        ON artists (lower(ltrim(youtube, '@')));
CREATE INDEX IF NOT EXISTS artists_handle_youtubechannel_idx ON artists (lower(ltrim(youtubechannel, '@')));
CREATE INDEX IF NOT EXISTS artists_handle_soundcloud_idx     ON artists (lower(ltrim(soundcloud, '@')));
CREATE INDEX IF NOT EXISTS artists_handle_bandcamp_idx       ON artists (lower(ltrim(bandcamp, '@')));
CREATE INDEX IF NOT EXISTS artists_handle_twitch_idx         ON artists (lower(ltrim(twitch, '@')));
CREATE INDEX IF NOT EXISTS artists_handle_facebook_idx       ON artists (lower(ltrim(facebook, '@')));
CREATE INDEX IF NOT EXISTS artists_handle_spotify_idx        ON artists (lower(ltrim(spotify, '@')));
CREATE INDEX IF NOT EXISTS artists_handle_deezer_idx         ON artists (lower(ltrim(deezer, '@')));
COMMIT;
