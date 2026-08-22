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
