-- What an artist's own captions say, extracted once and kept.
--
-- socialCredits.ts reads captions with a model and returns role credits and
-- artist statements, each verified against the post it came from. That is a
-- Gemini call per fifteen captions, so it must not run on every read: the
-- knowledge document rebuilds whenever a source is approved, rejected or
-- deleted, and recomputing there would both pay for the extraction each time
-- and let credits flap in and out between rebuilds.
--
-- Written by the same background job that writes the posts, read by
-- questionGenerator and artistDocService.
--
-- RLS: the app connects as the non-privileged `mnweb` role, and a table with
-- RLS enabled and no policy for that role is silently unwritable from the app
-- while working fine for any superuser tool. Policies with REAL expressions,
-- matching artist_social_posts. See docs/db-fixes/2026-07-27-prod-rls-fix.md
-- for what the empty-expression version of this mistake cost last time.

CREATE TABLE IF NOT EXISTS artist_social_credits (
    id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    artist_id    uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    platform     text NOT NULL DEFAULT 'instagram',
    -- 'credit' = a person given a role; 'statement' = the artist on their own work.
    kind         text NOT NULL,
    -- credit only: the handle or name credited.
    subject      text,
    -- credit only: true when `subject` is a linkable handle.
    is_handle    boolean NOT NULL DEFAULT false,
    -- credit only: true when the artist credited themselves. A fact, never an edge.
    is_self      boolean NOT NULL DEFAULT false,
    -- credit: the role in their words. statement: what the quote is about.
    label        text NOT NULL,
    -- The sentence this was read from, verified to appear in the caption.
    quote        text NOT NULL,
    -- The post it came from. Every row is traceable to a real caption.
    source_url   text NOT NULL,
    posted_at    timestamptz,
    created_at   timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    CONSTRAINT artist_social_credits_kind_check CHECK (kind IN ('credit', 'statement'))
);

-- Re-extracting an artist must not duplicate what it already found.
CREATE UNIQUE INDEX IF NOT EXISTS artist_social_credits_uniq
    ON artist_social_credits (artist_id, kind, source_url, md5(quote), coalesce(subject, ''));

CREATE INDEX IF NOT EXISTS idx_artist_social_credits_artist
    ON artist_social_credits (artist_id, kind);

-- Table-level privileges FIRST. RLS policies filter rows only AFTER Postgres
-- has checked that the role may touch the table at all, so a policy without a
-- grant permits nothing. Dev has default privileges configured, which granted
-- these automatically at CREATE TABLE and made a hand-run write test pass — so
-- the omission was invisible exactly where it was tested. 0016 gets this right;
-- this migration did not until a review caught it.
GRANT SELECT, INSERT, UPDATE, DELETE ON artist_social_credits TO mnweb;

ALTER TABLE artist_social_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY mnweb_select_artist_social_credits ON artist_social_credits
    AS PERMISSIVE FOR SELECT TO mnweb USING (true);
CREATE POLICY mnweb_insert_artist_social_credits ON artist_social_credits
    AS PERMISSIVE FOR INSERT TO mnweb WITH CHECK (true);
CREATE POLICY mnweb_update_artist_social_credits ON artist_social_credits
    AS PERMISSIVE FOR UPDATE TO mnweb USING (true) WITH CHECK (true);
CREATE POLICY mnweb_delete_artist_social_credits ON artist_social_credits
    AS PERMISSIVE FOR DELETE TO mnweb USING (true);
