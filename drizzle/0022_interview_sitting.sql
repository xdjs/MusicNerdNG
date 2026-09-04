-- WHICH SITTING A QUESTION BELONGS TO, stored rather than inferred.
--
-- Telling an artist's first interview from a return decides two things: whether
-- the static bank fills a short sitting, and whether they are greeted as a
-- first-timer. Five successive attempts derived it from row timestamps and each
-- one had a hole, because the fact is not in the data: `upsertInterviewAnswer`
-- re-stamps `created_at` when a question is answered, so a dealt-with row's
-- original OFFER time — the only thing that identifies its sitting — is
-- destroyed the moment it is used.
--
-- Backfilled to 1. Every artist with rows today has had exactly one sitting
-- offered to them, and a null would read as "unknown" in code that has no
-- unknown branch.
ALTER TABLE artist_interview_answers ADD COLUMN IF NOT EXISTS sitting integer;

UPDATE artist_interview_answers SET sitting = 1 WHERE sitting IS NULL;

-- No GRANT or policy: table-level privileges cover columns added later, and
-- artist_interview_answers already has both from 0011.
