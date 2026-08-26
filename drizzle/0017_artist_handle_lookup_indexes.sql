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
