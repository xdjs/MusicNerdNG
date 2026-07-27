-- Fix misconfigured RLS policies for the app database role `mnweb` on the three
-- artist-profile-edit tables (claims, vault sources, bio versions).
--
-- These policies were created out-of-band (Supabase-managed, not via tracked migrations)
-- with EMPTY USING / WITH CHECK expressions on production. A permissive policy with no
-- check expression grants nothing, so RLS silently blocked the app from inserting/updating
-- — breaking profile claiming, vault sources, and "save bio to vault" on prod. (Dev/staging
-- have the correct expressions, which is why the features worked there but not on prod.)
--
-- This restores the correct permissive expressions, matching the working pattern already
-- present on `ugcresearch` / `artists`. It is idempotent (re-asserting an already-correct
-- expression is a no-op) and uses ALTER POLICY (in-place, no drop/recreate window).
--
-- NOTE: assumes the named policies already exist (they do on every environment restored
-- from a Supabase backup). Applied to prod on 2026-07-27; recorded here so the change is
-- reproducible and reaches all environments via the migration pipeline.

-- artist_claims
ALTER POLICY mnweb_insert_artist_claims ON artist_claims WITH CHECK (true);
ALTER POLICY mnweb_select_artist_claims ON artist_claims USING (true);
ALTER POLICY mnweb_update_artist_claims ON artist_claims USING (true) WITH CHECK (true);

-- artist_vault_sources
ALTER POLICY mnweb_insert_artist_vault_sources ON artist_vault_sources WITH CHECK (true);
ALTER POLICY mnweb_select_artist_vault_sources ON artist_vault_sources USING (true);
ALTER POLICY mnweb_update_artist_vault_sources ON artist_vault_sources USING (true) WITH CHECK (true);

-- artist_bio_versions (INSERT + UPDATE were empty; SELECT/DELETE already correct)
ALTER POLICY mnweb_insert_artist_bio_versions ON artist_bio_versions WITH CHECK (true);
ALTER POLICY mnweb_update_artist_bio_versions ON artist_bio_versions USING (true) WITH CHECK (true);
