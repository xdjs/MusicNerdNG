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
