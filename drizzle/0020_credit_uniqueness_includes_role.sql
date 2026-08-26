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
