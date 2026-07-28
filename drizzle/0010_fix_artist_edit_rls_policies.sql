-- Fix / define the RLS policies for the app database role `mnweb` on the three
-- artist-profile-edit tables (claims, vault sources, bio versions).
--
-- These policies were created out-of-band (Supabase-managed, not via tracked migrations)
-- with EMPTY USING / WITH CHECK expressions on production. A permissive policy with no
-- check expression grants nothing, so RLS silently blocked the app from inserting/updating
-- — breaking profile claiming, vault sources, and "save bio to vault" on prod. (Dev/staging
-- had the correct expressions, which is why the features worked there but not on prod.)
--
-- Uses DROP POLICY IF EXISTS + CREATE POLICY so this migration is PORTABLE: it works whether
-- the policy already exists (current prod/dev/staging, restored Supabase backups) or not
-- (a from-scratch DB or a pipeline replaying drizzle/*.sql end-to-end). Drizzle wraps the
-- migration in a transaction, so the drop/create is atomic — no window where the app is denied.
-- The expressions match the working pattern already present on `ugcresearch` / `artists`.
-- (Applied to prod 2026-07-27; recorded here so the change is reproducible across environments.)

-- artist_claims
DROP POLICY IF EXISTS mnweb_insert_artist_claims ON artist_claims;--> statement-breakpoint
CREATE POLICY mnweb_insert_artist_claims ON artist_claims FOR INSERT TO mnweb WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS mnweb_select_artist_claims ON artist_claims;--> statement-breakpoint
CREATE POLICY mnweb_select_artist_claims ON artist_claims FOR SELECT TO mnweb USING (true);--> statement-breakpoint
DROP POLICY IF EXISTS mnweb_update_artist_claims ON artist_claims;--> statement-breakpoint
CREATE POLICY mnweb_update_artist_claims ON artist_claims FOR UPDATE TO mnweb USING (true) WITH CHECK (true);--> statement-breakpoint

-- artist_vault_sources
DROP POLICY IF EXISTS mnweb_insert_artist_vault_sources ON artist_vault_sources;--> statement-breakpoint
CREATE POLICY mnweb_insert_artist_vault_sources ON artist_vault_sources FOR INSERT TO mnweb WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS mnweb_select_artist_vault_sources ON artist_vault_sources;--> statement-breakpoint
CREATE POLICY mnweb_select_artist_vault_sources ON artist_vault_sources FOR SELECT TO mnweb USING (true);--> statement-breakpoint
DROP POLICY IF EXISTS mnweb_update_artist_vault_sources ON artist_vault_sources;--> statement-breakpoint
CREATE POLICY mnweb_update_artist_vault_sources ON artist_vault_sources FOR UPDATE TO mnweb USING (true) WITH CHECK (true);--> statement-breakpoint

-- artist_bio_versions (INSERT + UPDATE were empty; SELECT/DELETE were already correct)
DROP POLICY IF EXISTS mnweb_insert_artist_bio_versions ON artist_bio_versions;--> statement-breakpoint
CREATE POLICY mnweb_insert_artist_bio_versions ON artist_bio_versions FOR INSERT TO mnweb WITH CHECK (true);--> statement-breakpoint
DROP POLICY IF EXISTS mnweb_update_artist_bio_versions ON artist_bio_versions;--> statement-breakpoint
CREATE POLICY mnweb_update_artist_bio_versions ON artist_bio_versions FOR UPDATE TO mnweb USING (true) WITH CHECK (true);
