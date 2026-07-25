-- Reproducible seed for the Subvert platform's urlmap row.
--
-- The urlmap table is data (not schema), and its rows historically live only in the
-- production database rather than in tracked migrations — so a fresh environment
-- restored from migrations alone would recognize no platforms. This file records the
-- exact Subvert config so it can be re-applied to any environment (staging, a new
-- clone, etc.). It is idempotent: safe to run repeatedly; a no-op if the row exists.
--
-- Apply with either:
--   supabase db query --linked --file drizzle/seed/subvert_urlmap.sql
--   psql "$SUPABASE_DB_CONNECTION" -f drizzle/seed/subvert_urlmap.sql
--
-- (A broader "seed all urlmap rows from the repo" mechanism is a project-wide
--  follow-up; this file only covers the platform added in this change.)

INSERT INTO urlmap (
  site_name, site_url, example, app_string_format, regex,
  platform_type_list, is_monetized, is_web3_site,
  card_platform_name, card_description, color_hex, site_image,
  is_iframe_enabled, is_embed_enabled, "order"
)
SELECT
  'subvert',
  'subvert.fm',
  'https://www.subvert.fm/ARTIST_NAME',
  'https://www.subvert.fm/%@',
  '^https?://(?:www\.)?subvert\.fm/([^/?#]+)',
  ARRAY['listen']::platform_type[],
  true,
  false,
  'Subvert',
  'Support their work on %@',
  '#1A1A1A',
  '/siteIcons/subvert_icon.jpg',
  false,
  false,
  51
WHERE NOT EXISTS (SELECT 1 FROM urlmap WHERE site_name = 'subvert');
