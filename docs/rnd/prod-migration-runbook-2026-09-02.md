# Production migration runbook — 2026-09-02

Run these against **production** Supabase (`cbabvmebugudeuylronz`) in the SQL
editor, in order, before deploying code that depends on them. Migrations
0011–0021 were required before #1195; 0022–0023 are required before #1200.
Merging first starts application paths against tables or columns that do not
exist yet.

Each block is wrapped in `BEGIN` / `COMMIT`. Postgres DDL is transactional, so a failure rolls the whole step back rather than leaving the schema half-applied. Run one block, run its check, then move on.

## Before you start

Do **not** treat any whole step below as safe to re-run. Some individual table
and index statements use `IF NOT EXISTS`, but several migrations also contain
unguarded constraints or `CREATE POLICY` statements that fail when the object
already exists. Run this first:

```sql
SELECT
  t.name,
  CASE WHEN to_regclass('public.' || t.name) IS NULL THEN 'absent — will be created' ELSE 'ALREADY EXISTS — stop' END AS status
FROM (VALUES
  ('artist_docs'), ('artist_interview_answers'), ('artist_onboarding_steps'),
  ('artist_social_posts'), ('artist_social_profiles'),
  ('artist_doc_corrections'), ('artist_social_credits'), ('artist_research_jobs')
) AS t(name);
```

For a database starting at 0011, all eight should read `absent`. If 0011–0021
were already applied, all eight should exist—but table presence alone is not
proof that the column- and index-only migrations landed. Before skipping to
0022, run the **Check** query after every 0011–0021 section and confirm every
named artifact is present, including the columns from 0013 and 0015 and the
indexes from 0017, 0019, and 0020. Any missing artifact or mixed table result
means a partial migration: stop and reconcile it instead of rerunning a whole
block.


## 0011_flimsy_robbie_robertson.sql

Creates: `artist_docs` (table), `artist_interview_answers` (table), `artist_onboarding_steps` (table), `idx_artist_interview_answers_artist_id` (index), `idx_artist_onboarding_steps_artist_id` (index)

```sql
BEGIN;

CREATE TABLE "artist_docs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"artist_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
	CONSTRAINT "artist_docs_artist_id_key" UNIQUE("artist_id")
);
--> statement-breakpoint
ALTER TABLE "artist_docs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "artist_interview_answers" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"artist_id" uuid NOT NULL,
	"question_key" text NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
	CONSTRAINT "artist_interview_answers_artist_question_uniq" UNIQUE("artist_id","question_key")
);
--> statement-breakpoint
ALTER TABLE "artist_interview_answers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "artist_onboarding_steps" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"artist_id" uuid NOT NULL,
	"step" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
	CONSTRAINT "artist_onboarding_steps_artist_step_uniq" UNIQUE("artist_id","step")
);
--> statement-breakpoint
ALTER TABLE "artist_onboarding_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "artist_docs" ADD CONSTRAINT "artist_docs_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_interview_answers" ADD CONSTRAINT "artist_interview_answers_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_onboarding_steps" ADD CONSTRAINT "artist_onboarding_steps_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_artist_interview_answers_artist_id" ON "artist_interview_answers" USING btree ("artist_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_artist_onboarding_steps_artist_id" ON "artist_onboarding_steps" USING btree ("artist_id" uuid_ops);--> statement-breakpoint
CREATE POLICY "mnweb_select_artist_docs" ON "artist_docs" AS PERMISSIVE FOR SELECT TO "mnweb" USING (true);--> statement-breakpoint
CREATE POLICY "mnweb_insert_artist_docs" ON "artist_docs" AS PERMISSIVE FOR INSERT TO "mnweb" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "mnweb_update_artist_docs" ON "artist_docs" AS PERMISSIVE FOR UPDATE TO "mnweb" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "mnweb_delete_artist_docs" ON "artist_docs" AS PERMISSIVE FOR DELETE TO "mnweb" USING (true);--> statement-breakpoint
CREATE POLICY "mnweb_select_artist_interview_answers" ON "artist_interview_answers" AS PERMISSIVE FOR SELECT TO "mnweb" USING (true);--> statement-breakpoint
CREATE POLICY "mnweb_insert_artist_interview_answers" ON "artist_interview_answers" AS PERMISSIVE FOR INSERT TO "mnweb" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "mnweb_update_artist_interview_answers" ON "artist_interview_answers" AS PERMISSIVE FOR UPDATE TO "mnweb" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "mnweb_delete_artist_interview_answers" ON "artist_interview_answers" AS PERMISSIVE FOR DELETE TO "mnweb" USING (true);--> statement-breakpoint
CREATE POLICY "mnweb_select_artist_onboarding_steps" ON "artist_onboarding_steps" AS PERMISSIVE FOR SELECT TO "mnweb" USING (true);--> statement-breakpoint
CREATE POLICY "mnweb_insert_artist_onboarding_steps" ON "artist_onboarding_steps" AS PERMISSIVE FOR INSERT TO "mnweb" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "mnweb_delete_artist_onboarding_steps" ON "artist_onboarding_steps" AS PERMISSIVE FOR DELETE TO "mnweb" USING (true);


-- Dev grants these automatically via ALTER DEFAULT PRIVILEGES
-- (mnweb=arwd on new public tables). Production may not have that
-- default, and RLS policies grant nothing without table privileges --
-- that is the 2026-07-27 failure. GRANT is idempotent, so this is
-- safe either way.
GRANT SELECT, INSERT, UPDATE, DELETE ON artist_docs TO mnweb;
GRANT SELECT, INSERT, UPDATE, DELETE ON artist_interview_answers TO mnweb;
GRANT SELECT, INSERT, UPDATE, DELETE ON artist_onboarding_steps TO mnweb;
COMMIT;
```

Check:

```sql
SELECT * FROM (VALUES
  ('table', 'artist_docs', to_regclass('public.artist_docs') IS NOT NULL),
  ('table', 'artist_interview_answers', to_regclass('public.artist_interview_answers') IS NOT NULL),
  ('table', 'artist_onboarding_steps', to_regclass('public.artist_onboarding_steps') IS NOT NULL),
  ('index', 'idx_artist_interview_answers_artist_id', to_regclass('public.idx_artist_interview_answers_artist_id') IS NOT NULL),
  ('index', 'idx_artist_onboarding_steps_artist_id', to_regclass('public.idx_artist_onboarding_steps_artist_id') IS NOT NULL)
) AS t(kind, name, present);
```


## 0012_clever_lester.sql

Creates: `artist_social_posts` (table), `artist_social_profiles` (table), `idx_artist_social_posts_artist_id` (index), `idx_artist_social_posts_own` (index), `idx_artist_social_profiles_artist_id` (index)

```sql
BEGIN;

CREATE TABLE "artist_social_posts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"artist_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"platform_post_id" text NOT NULL,
	"owner_username" text NOT NULL,
	"is_own_post" boolean NOT NULL,
	"caption" text,
	"url" text NOT NULL,
	"posted_at" timestamp with time zone,
	"like_count" integer,
	"comment_count" integer,
	"play_count" integer,
	"hashtags" text[] DEFAULT '{}' NOT NULL,
	"mentions" text[] DEFAULT '{}' NOT NULL,
	"coauthors" text[] DEFAULT '{}' NOT NULL,
	"music_title" text,
	"music_artist" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
	CONSTRAINT "artist_social_posts_artist_platform_post_uniq" UNIQUE("artist_id","platform","platform_post_id")
);
--> statement-breakpoint
ALTER TABLE "artist_social_posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "artist_social_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"artist_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"handle" text NOT NULL,
	"followers_count" integer,
	"bio" text,
	"avatar_url" text,
	"scraped_at" timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
	CONSTRAINT "artist_social_profiles_artist_platform_uniq" UNIQUE("artist_id","platform")
);
--> statement-breakpoint
ALTER TABLE "artist_social_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "artist_social_posts" ADD CONSTRAINT "artist_social_posts_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_social_profiles" ADD CONSTRAINT "artist_social_profiles_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_artist_social_posts_artist_id" ON "artist_social_posts" USING btree ("artist_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_artist_social_posts_own" ON "artist_social_posts" USING btree ("artist_id","is_own_post");--> statement-breakpoint
CREATE INDEX "idx_artist_social_profiles_artist_id" ON "artist_social_profiles" USING btree ("artist_id" uuid_ops);--> statement-breakpoint
CREATE POLICY "mnweb_select_artist_social_posts" ON "artist_social_posts" AS PERMISSIVE FOR SELECT TO "mnweb" USING (true);--> statement-breakpoint
CREATE POLICY "mnweb_insert_artist_social_posts" ON "artist_social_posts" AS PERMISSIVE FOR INSERT TO "mnweb" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "mnweb_update_artist_social_posts" ON "artist_social_posts" AS PERMISSIVE FOR UPDATE TO "mnweb" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "mnweb_delete_artist_social_posts" ON "artist_social_posts" AS PERMISSIVE FOR DELETE TO "mnweb" USING (true);--> statement-breakpoint
CREATE POLICY "mnweb_select_artist_social_profiles" ON "artist_social_profiles" AS PERMISSIVE FOR SELECT TO "mnweb" USING (true);--> statement-breakpoint
CREATE POLICY "mnweb_insert_artist_social_profiles" ON "artist_social_profiles" AS PERMISSIVE FOR INSERT TO "mnweb" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "mnweb_update_artist_social_profiles" ON "artist_social_profiles" AS PERMISSIVE FOR UPDATE TO "mnweb" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "mnweb_delete_artist_social_profiles" ON "artist_social_profiles" AS PERMISSIVE FOR DELETE TO "mnweb" USING (true);


-- Dev grants these automatically via ALTER DEFAULT PRIVILEGES
-- (mnweb=arwd on new public tables). Production may not have that
-- default, and RLS policies grant nothing without table privileges --
-- that is the 2026-07-27 failure. GRANT is idempotent, so this is
-- safe either way.
GRANT SELECT, INSERT, UPDATE, DELETE ON artist_social_posts TO mnweb;
GRANT SELECT, INSERT, UPDATE, DELETE ON artist_social_profiles TO mnweb;
COMMIT;
```

Check:

```sql
SELECT * FROM (VALUES
  ('table', 'artist_social_posts', to_regclass('public.artist_social_posts') IS NOT NULL),
  ('table', 'artist_social_profiles', to_regclass('public.artist_social_profiles') IS NOT NULL),
  ('index', 'idx_artist_social_posts_artist_id', to_regclass('public.idx_artist_social_posts_artist_id') IS NOT NULL),
  ('index', 'idx_artist_social_posts_own', to_regclass('public.idx_artist_social_posts_own') IS NOT NULL),
  ('index', 'idx_artist_social_profiles_artist_id', to_regclass('public.idx_artist_social_profiles_artist_id') IS NOT NULL)
) AS t(kind, name, present);
```


## 0013_confused_ink.sql

Creates: `artist_docs.sources` (column)

```sql
BEGIN;

ALTER TABLE "artist_docs" ADD COLUMN "sources" jsonb DEFAULT '[]'::jsonb NOT NULL;

COMMIT;
```

Check:

```sql
SELECT count(*) = 1 AS column_present FROM information_schema.columns
 WHERE table_name = 'artist_docs' AND column_name = 'sources';
```


## 0014_vault_source_url_unique.sql

Creates: `artist_vault_sources_artist_url_uniq` (index)

```sql
BEGIN;

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

COMMIT;
```

Check:

```sql
SELECT * FROM (VALUES
  ('index', 'artist_vault_sources_artist_url_uniq', to_regclass('public.artist_vault_sources_artist_url_uniq') IS NOT NULL)
) AS t(kind, name, present);
```


## 0015_vault_source_published_at.sql

Creates: `artist_vault_sources.published_at` (column)

```sql
BEGIN;

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

COMMIT;
```

Check:

```sql
SELECT count(*) = 1 AS column_present FROM information_schema.columns
 WHERE table_name = 'artist_vault_sources' AND column_name = 'published_at';
```


## 0016_artist_doc_corrections.sql

Creates: `artist_doc_corrections` (table), `idx_artist_doc_corrections_artist_id` (index), `artist_doc_corrections_artist_claim_uniq` (index)

```sql
BEGIN;

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
```

Check:

```sql
SELECT * FROM (VALUES
  ('table', 'artist_doc_corrections', to_regclass('public.artist_doc_corrections') IS NOT NULL),
  ('index', 'idx_artist_doc_corrections_artist_id', to_regclass('public.idx_artist_doc_corrections_artist_id') IS NOT NULL),
  ('index', 'artist_doc_corrections_artist_claim_uniq', to_regclass('public.artist_doc_corrections_artist_claim_uniq') IS NOT NULL)
) AS t(kind, name, present);
```


## 0017_artist_handle_lookup_indexes.sql

Creates: `artists_lower_instagram_idx` (index), `artists_lower_x_idx` (index), `artists_lower_tiktok_idx` (index), `artists_lower_youtube_idx` (index), `artists_lower_youtubechannel_idx` (index), `artists_lower_soundcloud_idx` (index), `artists_lower_bandcamp_idx` (index), `artists_lower_twitch_idx` (index), `artists_lower_facebook_idx` (index), `artists_lower_spotify_idx` (index), `artists_lower_deezer_idx` (index)

```sql
BEGIN;

-- Cross-artist handle collision checks were sequential scans.
--
-- `handleBelongsToAnotherArtist` in vaultWebSearch.ts asks "is this handle
-- already assigned to a DIFFERENT artist in the directory" before adopting a
-- candidate. Three artists here are called Black Dave, so the check is what
-- stops one of them inheriting another's accounts.
--
-- It runs `lower(<platform>) = lower(<handle>)`, and a plain index on the column
-- cannot serve `lower(column)` — so every call scanned all ~42,000 rows.
-- Measured at 266ms per call on dev, and the propagation pass calls it once per
-- candidate handle per platform (up to ~50 calls), which is ten-plus seconds
-- against a 45s discovery budget.
--
-- These are FUNCTIONAL indexes on lower(column), matching the query exactly.
-- No RLS policies are needed: an index changes no grants and creates no table.
-- Plain CREATE INDEX rather than CONCURRENTLY because Drizzle runs migrations
-- inside a transaction (CONCURRENTLY cannot) and 42k rows builds in well under
-- a second.

CREATE INDEX IF NOT EXISTS artists_lower_instagram_idx      ON artists (lower(instagram));
CREATE INDEX IF NOT EXISTS artists_lower_x_idx              ON artists (lower(x));
CREATE INDEX IF NOT EXISTS artists_lower_tiktok_idx         ON artists (lower(tiktok));
CREATE INDEX IF NOT EXISTS artists_lower_youtube_idx        ON artists (lower(youtube));
CREATE INDEX IF NOT EXISTS artists_lower_youtubechannel_idx ON artists (lower(youtubechannel));
CREATE INDEX IF NOT EXISTS artists_lower_soundcloud_idx     ON artists (lower(soundcloud));
CREATE INDEX IF NOT EXISTS artists_lower_bandcamp_idx       ON artists (lower(bandcamp));
CREATE INDEX IF NOT EXISTS artists_lower_twitch_idx         ON artists (lower(twitch));
CREATE INDEX IF NOT EXISTS artists_lower_facebook_idx       ON artists (lower(facebook));
CREATE INDEX IF NOT EXISTS artists_lower_spotify_idx        ON artists (lower(spotify));
CREATE INDEX IF NOT EXISTS artists_lower_deezer_idx         ON artists (lower(deezer));

COMMIT;
```

Check:

```sql
SELECT * FROM (VALUES
  ('index', 'artists_lower_instagram_idx', to_regclass('public.artists_lower_instagram_idx') IS NOT NULL),
  ('index', 'artists_lower_x_idx', to_regclass('public.artists_lower_x_idx') IS NOT NULL),
  ('index', 'artists_lower_tiktok_idx', to_regclass('public.artists_lower_tiktok_idx') IS NOT NULL),
  ('index', 'artists_lower_youtube_idx', to_regclass('public.artists_lower_youtube_idx') IS NOT NULL),
  ('index', 'artists_lower_youtubechannel_idx', to_regclass('public.artists_lower_youtubechannel_idx') IS NOT NULL),
  ('index', 'artists_lower_soundcloud_idx', to_regclass('public.artists_lower_soundcloud_idx') IS NOT NULL),
  ('index', 'artists_lower_bandcamp_idx', to_regclass('public.artists_lower_bandcamp_idx') IS NOT NULL),
  ('index', 'artists_lower_twitch_idx', to_regclass('public.artists_lower_twitch_idx') IS NOT NULL),
  ('index', 'artists_lower_facebook_idx', to_regclass('public.artists_lower_facebook_idx') IS NOT NULL),
  ('index', 'artists_lower_spotify_idx', to_regclass('public.artists_lower_spotify_idx') IS NOT NULL),
  ('index', 'artists_lower_deezer_idx', to_regclass('public.artists_lower_deezer_idx') IS NOT NULL)
) AS t(kind, name, present);
```


## 0018_artist_social_credits.sql

Creates: `artist_social_credits` (table), `artist_social_credits_uniq` (index), `idx_artist_social_credits_artist` (index)

```sql
BEGIN;

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

COMMIT;
```

Check:

```sql
SELECT * FROM (VALUES
  ('table', 'artist_social_credits', to_regclass('public.artist_social_credits') IS NOT NULL),
  ('index', 'artist_social_credits_uniq', to_regclass('public.artist_social_credits_uniq') IS NOT NULL),
  ('index', 'idx_artist_social_credits_artist', to_regclass('public.idx_artist_social_credits_artist') IS NOT NULL)
) AS t(kind, name, present);
```


## 0019_handle_indexes_match_the_query.sql

Creates: `artists_handle_instagram_idx` (index), `artists_handle_x_idx` (index), `artists_handle_tiktok_idx` (index), `artists_handle_youtube_idx` (index), `artists_handle_youtubechannel_idx` (index), `artists_handle_soundcloud_idx` (index), `artists_handle_bandcamp_idx` (index), `artists_handle_twitch_idx` (index), `artists_handle_facebook_idx` (index), `artists_handle_spotify_idx` (index), `artists_handle_deezer_idx` (index)

```sql
BEGIN;

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

COMMIT;
```

Check:

```sql
SELECT * FROM (VALUES
  ('index', 'artists_handle_instagram_idx', to_regclass('public.artists_handle_instagram_idx') IS NOT NULL),
  ('index', 'artists_handle_x_idx', to_regclass('public.artists_handle_x_idx') IS NOT NULL),
  ('index', 'artists_handle_tiktok_idx', to_regclass('public.artists_handle_tiktok_idx') IS NOT NULL),
  ('index', 'artists_handle_youtube_idx', to_regclass('public.artists_handle_youtube_idx') IS NOT NULL),
  ('index', 'artists_handle_youtubechannel_idx', to_regclass('public.artists_handle_youtubechannel_idx') IS NOT NULL),
  ('index', 'artists_handle_soundcloud_idx', to_regclass('public.artists_handle_soundcloud_idx') IS NOT NULL),
  ('index', 'artists_handle_bandcamp_idx', to_regclass('public.artists_handle_bandcamp_idx') IS NOT NULL),
  ('index', 'artists_handle_twitch_idx', to_regclass('public.artists_handle_twitch_idx') IS NOT NULL),
  ('index', 'artists_handle_facebook_idx', to_regclass('public.artists_handle_facebook_idx') IS NOT NULL),
  ('index', 'artists_handle_spotify_idx', to_regclass('public.artists_handle_spotify_idx') IS NOT NULL),
  ('index', 'artists_handle_deezer_idx', to_regclass('public.artists_handle_deezer_idx') IS NOT NULL)
) AS t(kind, name, present);
```


## 0020_credit_uniqueness_includes_role.sql

Creates: `artist_social_credits_uniq` (index)

```sql
BEGIN;

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

COMMIT;
```

Check:

```sql
SELECT
  to_regclass('public.artist_social_credits_uniq') IS NOT NULL AS index_present,
  coalesce(i.indisunique, false) AS is_unique,
  coalesce(pg_get_indexdef(i.indexrelid) LIKE '%md5(label)%', false) AS includes_role
FROM (VALUES (1)) AS required(dummy)
LEFT JOIN pg_index i
  ON i.indexrelid = to_regclass('public.artist_social_credits_uniq');
```

Expected: `true | true | true`. The `includes_role` check distinguishes the
0020 replacement from the older index with the same name created by 0018.


## 0021_artist_research_jobs.sql

Creates: `artist_research_jobs` (table), `artist_research_jobs_one_live` (index), `artist_research_jobs_claimable` (index)

```sql
BEGIN;

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
```

Check:

```sql
SELECT * FROM (VALUES
  ('table', 'artist_research_jobs', to_regclass('public.artist_research_jobs') IS NOT NULL),
  ('index', 'artist_research_jobs_one_live', to_regclass('public.artist_research_jobs_one_live') IS NOT NULL),
  ('index', 'artist_research_jobs_claimable', to_regclass('public.artist_research_jobs_claimable') IS NOT NULL)
) AS t(kind, name, present);
```


## 0022_interview_sitting.sql

Adds: `artist_interview_answers.sitting`

The app connects as `mnweb`, while the SQL editor runs with the privileged role
needed for DDL. Existing table-level grants and RLS policies cover new columns;
the check below verifies both assumptions explicitly.

```sql
BEGIN;

ALTER TABLE artist_interview_answers
  ADD COLUMN IF NOT EXISTS sitting integer;

UPDATE artist_interview_answers
SET sitting = 1
WHERE sitting IS NULL;

COMMIT;
```

Check:

```sql
SELECT
  (SELECT count(*)
   FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'artist_interview_answers'
     AND column_name = 'sitting') AS column_exists,
  (SELECT count(*)
   FROM artist_interview_answers
   WHERE sitting IS NULL) AS still_null,
  has_column_privilege('mnweb', 'public.artist_interview_answers', 'sitting', 'SELECT') AS mnweb_can_read,
  has_column_privilege('mnweb', 'public.artist_interview_answers', 'sitting', 'INSERT') AS mnweb_can_insert,
  has_column_privilege('mnweb', 'public.artist_interview_answers', 'sitting', 'UPDATE') AS mnweb_can_update,
  (SELECT count(*) = 4
   FROM pg_policies p
   JOIN (VALUES
     ('mnweb_select_artist_interview_answers', 'SELECT', 'true'::text, NULL::text),
     ('mnweb_insert_artist_interview_answers', 'INSERT', NULL::text, 'true'::text),
     ('mnweb_update_artist_interview_answers', 'UPDATE', 'true'::text, 'true'::text),
     ('mnweb_delete_artist_interview_answers', 'DELETE', 'true'::text, NULL::text)
   ) AS expected(policyname, cmd, qual, with_check)
     ON p.policyname = expected.policyname
    AND p.cmd = expected.cmd
    AND lower(btrim(p.qual, '() ')) IS NOT DISTINCT FROM expected.qual
    AND lower(btrim(p.with_check, '() ')) IS NOT DISTINCT FROM expected.with_check
   WHERE p.schemaname = 'public'
     AND p.tablename = 'artist_interview_answers'
     AND p.permissive = 'PERMISSIVE'
     AND 'mnweb' = ANY(p.roles)) AS mnweb_policies_match_0011;
```

Expected: `1 | 0 | true | true | true | true`.


## 0023_interview_offer_watermark.sql

Adds: `artist_interview_answers.offered_at`

```sql
BEGIN;

ALTER TABLE artist_interview_answers
  ADD COLUMN IF NOT EXISTS offered_at timestamp with time zone;

ALTER TABLE artist_interview_answers
  ALTER COLUMN offered_at SET DEFAULT (now() AT TIME ZONE 'utc'::text);

UPDATE artist_interview_answers
SET offered_at = created_at
WHERE offered_at IS NULL;

ALTER TABLE artist_interview_answers
  ALTER COLUMN offered_at SET NOT NULL;

COMMIT;
```

Check:

```sql
SELECT
  (SELECT count(*)
   FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'artist_interview_answers'
     AND column_name = 'offered_at') AS column_exists,
  (SELECT count(*)
   FROM artist_interview_answers
   WHERE offered_at IS NULL) AS still_null,
  has_column_privilege('mnweb', 'public.artist_interview_answers', 'offered_at', 'SELECT') AS mnweb_can_read,
  has_column_privilege('mnweb', 'public.artist_interview_answers', 'offered_at', 'INSERT') AS mnweb_can_insert,
  has_column_privilege('mnweb', 'public.artist_interview_answers', 'offered_at', 'UPDATE') AS mnweb_can_update,
  (SELECT count(*) = 4
   FROM pg_policies p
   JOIN (VALUES
     ('mnweb_select_artist_interview_answers', 'SELECT', 'true'::text, NULL::text),
     ('mnweb_insert_artist_interview_answers', 'INSERT', NULL::text, 'true'::text),
     ('mnweb_update_artist_interview_answers', 'UPDATE', 'true'::text, 'true'::text),
     ('mnweb_delete_artist_interview_answers', 'DELETE', 'true'::text, NULL::text)
   ) AS expected(policyname, cmd, qual, with_check)
     ON p.policyname = expected.policyname
    AND p.cmd = expected.cmd
    AND lower(btrim(p.qual, '() ')) IS NOT DISTINCT FROM expected.qual
    AND lower(btrim(p.with_check, '() ')) IS NOT DISTINCT FROM expected.with_check
   WHERE p.schemaname = 'public'
     AND p.tablename = 'artist_interview_answers'
     AND p.permissive = 'PERMISSIVE'
     AND 'mnweb' = ANY(p.roles)) AS mnweb_policies_match_0011;
```

Expected: `1 | 0 | true | true | true | true`.


## After all thirteen

```sql
SELECT * FROM (VALUES
  ('table', 'artist_docs', to_regclass('public.artist_docs') IS NOT NULL),
  ('table', 'artist_interview_answers', to_regclass('public.artist_interview_answers') IS NOT NULL),
  ('table', 'artist_onboarding_steps', to_regclass('public.artist_onboarding_steps') IS NOT NULL),
  ('table', 'artist_social_posts', to_regclass('public.artist_social_posts') IS NOT NULL),
  ('table', 'artist_social_profiles', to_regclass('public.artist_social_profiles') IS NOT NULL),
  ('table', 'artist_doc_corrections', to_regclass('public.artist_doc_corrections') IS NOT NULL),
  ('table', 'artist_social_credits', to_regclass('public.artist_social_credits') IS NOT NULL),
  ('table', 'artist_research_jobs', to_regclass('public.artist_research_jobs') IS NOT NULL),
  ('column', 'artist_interview_answers.sitting', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'artist_interview_answers' AND column_name = 'sitting'
  )),
  ('column', 'artist_interview_answers.offered_at', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'artist_interview_answers' AND column_name = 'offered_at'
  ))
) AS t(kind, name, present);
```

Every per-step artifact check must pass. This final summary should show ten rows,
all `true`, and both column checks above must return
`1 | 0 | true | true | true | true`. Then #1200's database prerequisite is
satisfied.

## One caveat

These are being applied by hand rather than through `drizzle-kit migrate`, so
nothing writes to Drizzle's migration journal. That matches how dev was done
and how the July RLS fix went in, but it means a future `db:migrate` against
production would try to re-apply them. Do not use `db:migrate` to catch this
database up until its journal has been reconciled: multiple steps are
non-idempotent, including the unguarded `CREATE POLICY` statements in 0018 and
0021, and migration would stop at the first existing object before
later work could run.
