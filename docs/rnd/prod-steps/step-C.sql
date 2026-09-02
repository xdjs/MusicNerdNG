-- STEP C — 0018, 0020, 0021
-- ==============================================================
BEGIN;

-- ---- 0018_artist_social_credits.sql ----
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

-- ---- 0020_credit_uniqueness_includes_role.sql ----
-- One caption can credit the same person with more than one role.
--
-- 0018's uniqueness key was (artist_id, kind, source_url, md5(quote), subject),
-- which treats "Mixing & Mastering Engineer: @x" and "Mixed by @x" as the same
-- row when both were read from the same sentence. onConflictDoNothing then
-- silently discarded every role after the first, so the stored extraction and
-- the document lost valid credits without any error.
--
-- Pharaoh Sistare credits @p3t3rango as "engineered by", "Mixed by" and
-- "Mixing & Mastering Engineer"; Pete Rango's feed has several people with two
-- or three roles apiece.
DROP INDEX IF EXISTS artist_social_credits_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS artist_social_credits_uniq
    ON artist_social_credits (artist_id, kind, source_url, md5(quote), coalesce(subject, ''), md5(label));

-- ---- 0021_artist_research_jobs.sql ----
-- Long research work, outside the request that asked for it.
--
-- The Instagram scrape takes one to five minutes and caption extraction takes
-- seventy seconds for a small feed and several minutes for a large one. Both
-- were run from an onboarding turn via after(), which is bounded by the route's
-- 60s maxDuration — so on the primary flow the platform killed the invocation
-- partway and the credits never arrived. The document was then written from an
-- empty credits table, and nothing rebuilt it. Every artist except the ones we
-- pre-warmed by hand got a profile with none of this work in it.
--
-- A row here is a unit of work that survives the request that created it.
-- Progress lives on the row, so a slice that runs out of time leaves a cursor
-- rather than losing everything, and any later invocation continues from it.
--
-- WHY status AND cursor RATHER THAN "are there any rows yet".
-- The old completion check was "does this artist have any credit rows", which
-- cannot tell a half-finished extraction from a finished one, and reports an
-- artist whose captions genuinely contain nothing as never having run. Silence
-- meaning "we did not manage it" being read as "there is nothing there" is the
-- single most repeated bug in this subsystem. Status makes it impossible.
CREATE TABLE IF NOT EXISTS artist_research_jobs (
    id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    artist_id    uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    -- 'social_ingest' = fetch the feed; 'caption_extract' = read the captions.
    kind         text NOT NULL,
    status       text NOT NULL DEFAULT 'pending',
    -- How far the work got. For extraction, the index of the next caption batch.
    cursor       integer NOT NULL DEFAULT 0,
    -- Total units, when known, so a caller can show progress honestly.
    total        integer,
    -- Lease. A claimed job whose lease has expired is free again, so an
    -- invocation the platform killed does not wedge the queue forever.
    claimed_at   timestamptz,
    attempts     integer NOT NULL DEFAULT 0,
    last_error   text,
    -- Scratch space the job owns: the Apify run id, so a killed request does
    -- not orphan a run we can never find again.
    state        jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    updated_at   timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    CONSTRAINT artist_research_jobs_kind_check
        CHECK (kind IN ('social_ingest', 'caption_extract')),
    CONSTRAINT artist_research_jobs_status_check
        CHECK (status IN ('pending', 'running', 'done', 'failed'))
);
-- One live job per artist per kind, so enqueuing twice is a no-op rather than
-- two workers racing over the same captions.
CREATE UNIQUE INDEX IF NOT EXISTS artist_research_jobs_one_live
    ON artist_research_jobs (artist_id, kind)
    WHERE status IN ('pending', 'running');
-- The claim query: oldest claimable job first.
CREATE INDEX IF NOT EXISTS artist_research_jobs_claimable
    ON artist_research_jobs (status, claimed_at, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON artist_research_jobs TO mnweb;
ALTER TABLE artist_research_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY mnweb_select_artist_research_jobs ON artist_research_jobs
    AS PERMISSIVE FOR SELECT TO mnweb USING (true);
CREATE POLICY mnweb_insert_artist_research_jobs ON artist_research_jobs
    AS PERMISSIVE FOR INSERT TO mnweb WITH CHECK (true);
CREATE POLICY mnweb_update_artist_research_jobs ON artist_research_jobs
    AS PERMISSIVE FOR UPDATE TO mnweb USING (true) WITH CHECK (true);
CREATE POLICY mnweb_delete_artist_research_jobs ON artist_research_jobs
    AS PERMISSIVE FOR DELETE TO mnweb USING (true);
COMMIT;
