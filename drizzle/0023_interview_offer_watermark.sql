-- TWO CLOCKS, because an offered question has two distinct events.
--
-- `created_at` remains answer chronology: Ask uses it to keep the artist's
-- newest words in context. `offered_at` is the immutable material watermark:
-- a question can only represent what was known when it was put to the artist.
-- Keeping those events in one column either loses research learned during a
-- sitting or makes a newly submitted answer look old.
ALTER TABLE artist_interview_answers
    ADD COLUMN IF NOT EXISTS offered_at timestamp with time zone;

-- Install the default before the backfill so a concurrent old-version insert
-- cannot create a fresh null between the UPDATE and the NOT NULL constraint.
ALTER TABLE artist_interview_answers
    ALTER COLUMN offered_at SET DEFAULT (now() AT TIME ZONE 'utc'::text);

-- Before this column existed, created_at is the only safe boundary available.
UPDATE artist_interview_answers
SET offered_at = created_at
WHERE offered_at IS NULL;

ALTER TABLE artist_interview_answers
    ALTER COLUMN offered_at SET NOT NULL;

-- No GRANT or policy: table-level privileges cover columns added later, and
-- artist_interview_answers already has both from 0011.
