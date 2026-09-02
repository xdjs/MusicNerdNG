-- STEP A — 0013, 0014, 0015, 0016
-- Supabase will warn 'destructive operations'. That is 0014's
-- DELETE of duplicate (artist_id, url) vault rows. Verified on
-- production: 582 total rows, 0 duplicates. It deletes nothing.
-- ==============================================================
BEGIN;

-- ---- 0013_confused_ink.sql ----
ALTER TABLE "artist_docs" ADD COLUMN "sources" jsonb DEFAULT '[]'::jsonb NOT NULL;

-- ---- 0014_vault_source_url_unique.sql ----
-- One row per (artist, url) in the vault.
--
-- Deduplication was a read-then-write with nothing underneath it: discovery
-- reads the artist's existing source URLs, then inserts whatever is new. Two
-- runs overlapping in time both read "absent" and both insert, so a real
-- artist's vault held the same LIFE CHANGES interview and the same VoyageMIA
-- profile twice, at byte-identical URLs.
--
-- Recorded in MEMORY.md as the "concurrent first-view dedup" gap: two
-- simultaneous first-time viewers of a never-generated artist can both pass the
-- empty-vault check. A constraint fixes it for every caller at once, where an
-- application-level lock would only cover the paths that remembered to take it.
--
-- Existing duplicates are collapsed first, keeping the oldest row of each set so
-- any approve/reject decision already made on it survives.
DELETE FROM artist_vault_sources a
USING artist_vault_sources b
WHERE a.artist_id = b.artist_id
  AND a.url = b.url
  AND a.created_at > b.created_at;
CREATE UNIQUE INDEX IF NOT EXISTS artist_vault_sources_artist_url_uniq
  ON artist_vault_sources (artist_id, url);

-- ---- 0015_vault_source_published_at.sql ----
-- When each source says it was published.
--
-- Without a date, everything a source contains reads as current. A real artist's
-- profile stated "Parris Pierce is my production partner" in the present tense,
-- taken from a VoyageMIA interview published 2019-01-10 — true about the moment
-- it was written, and silently presented as true seven years later.
--
-- The knowledge document already has an anti-inflation rule telling it to scope
-- recent-only claims in time. It could not follow that rule, because nothing in
-- its material said when anything happened.
--
-- Nullable on purpose: plenty of pages never state a date, and a guessed one is
-- worse than none — it would let the document confidently scope a claim to the
-- wrong era. No date means the claim stays unscoped rather than mis-scoped.
ALTER TABLE artist_vault_sources ADD COLUMN IF NOT EXISTS published_at date;

-- ---- 0016_artist_doc_corrections.sql ----
-- What the artist has told us directly, which outranks anything we read.
--
-- The knowledge document is REGENERATED whenever an artist's sources change
-- (refreshArtistDoc). So a correction typed into the document itself would be
-- destroyed the next time they added or removed a source — the edit would appear
-- to work and then silently vanish days later.
--
-- Corrections therefore live outside the document and are re-injected into every
-- rebuild. Same durability the source rejections already have: the artist's
-- judgement accumulates rather than being undone.
--
-- `kind`:
--   'wrong'  — "that isn't me / that's not true". `correction` is null.
--   'fix'    — the artist supplied a replacement, held in `correction`.
--
-- Keyed by the claim TEXT rather than a position, because a rebuild reorders and
-- renumbers everything; the wording is what survives, and a near-miss simply
-- means one stale correction the model can ignore.
CREATE TABLE IF NOT EXISTS artist_doc_corrections (
    id uuid DEFAULT uuid_generate_v4() PRIMARY KEY NOT NULL,
    artist_id uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    claim text NOT NULL,
    correction text,
    kind text NOT NULL DEFAULT 'wrong',
    created_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
    updated_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artist_doc_corrections_artist_id
    ON artist_doc_corrections USING btree (artist_id);
-- One correction per (artist, claim): correcting the same claim twice updates it
-- rather than stacking two contradictory instructions into the next rebuild.
-- Plain columns rather than md5(claim) so the app's ORM can name this as an
-- upsert target; writes cap the claim length, so it cannot approach the btree
-- entry limit.
CREATE UNIQUE INDEX IF NOT EXISTS artist_doc_corrections_artist_claim_uniq
    ON artist_doc_corrections (artist_id, claim);
-- RLS. The app connects as `mnweb`, NOT as a superuser, so a new table without
-- explicit policies is invisible and unwritable to the running app — the feature
-- works in the Supabase SQL editor and is dead in production. Precedent:
-- 0010_fix_artist_edit_rls_policies.sql, which restored EMPTY policies that had
-- silently broken claiming and vault sources on prod.
--
-- These gate "is this the mnweb role at all", nothing finer. Real authorization
-- is in application code (verifyArtistEditable / canEditArtist).
ALTER TABLE artist_doc_corrections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mnweb_select_artist_doc_corrections ON artist_doc_corrections;
CREATE POLICY mnweb_select_artist_doc_corrections ON artist_doc_corrections
    AS PERMISSIVE FOR SELECT TO mnweb USING (true);
DROP POLICY IF EXISTS mnweb_insert_artist_doc_corrections ON artist_doc_corrections;
CREATE POLICY mnweb_insert_artist_doc_corrections ON artist_doc_corrections
    AS PERMISSIVE FOR INSERT TO mnweb WITH CHECK (true);
DROP POLICY IF EXISTS mnweb_update_artist_doc_corrections ON artist_doc_corrections;
CREATE POLICY mnweb_update_artist_doc_corrections ON artist_doc_corrections
    AS PERMISSIVE FOR UPDATE TO mnweb USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS mnweb_delete_artist_doc_corrections ON artist_doc_corrections;
CREATE POLICY mnweb_delete_artist_doc_corrections ON artist_doc_corrections
    AS PERMISSIVE FOR DELETE TO mnweb USING (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON artist_doc_corrections TO mnweb;
COMMIT;
