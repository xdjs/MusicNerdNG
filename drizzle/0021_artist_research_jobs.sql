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
