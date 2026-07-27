-- Reproducible seed for the Bluesky platform's urlmap row.
--
-- The urlmap table is data (not schema), and its rows historically live only in the
-- production database rather than in tracked migrations — so a fresh environment
-- restored from migrations alone would recognize no platforms. This file records the
-- exact Bluesky config so it can be re-applied to any environment. Idempotent: safe
-- to run repeatedly; a no-op if the row already exists.
--
-- Apply with either:
--   supabase db query --linked --file drizzle/seed/bluesky_urlmap.sql
--   psql "$SUPABASE_DB_CONNECTION" -f drizzle/seed/bluesky_urlmap.sql
--
-- The "order" value is chosen relative to the target DB's current max; adjust if this
-- seed is reused on an environment where that value is already taken.

INSERT INTO urlmap (
  site_name, site_url, example, app_string_format, regex,
  platform_type_list, is_monetized, is_web3_site,
  card_platform_name, card_description, color_hex, site_image,
  is_iframe_enabled, is_embed_enabled, "order"
)
SELECT
  'bluesky',
  'bsky.app',
  'https://bsky.app/profile/ARTIST_HANDLE',
  'https://bsky.app/profile/%@',
  '^https?://(?:www\.)?bsky\.app/profile/([^/?#]+)',
  ARRAY['social']::platform_type[],
  false,
  false,
  'Bluesky',
  'Follow them on %@',
  '#1185FE',
  '/siteIcons/bluesky_icon.png',
  false,
  false,
  (SELECT COALESCE(MAX("order"), 0) + 1 FROM urlmap)
WHERE NOT EXISTS (SELECT 1 FROM urlmap WHERE site_name = 'bluesky');
