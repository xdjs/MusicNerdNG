-- Things an artist said in public that they do not want their page repeating.
--
-- The extractor reads an artist's captions and stores what they said about
-- themselves and their work. It has no way to tell a story about a record from
-- a eulogy: Pete Rango's memorial post for his cousin André produced four
-- statements, one about the music André gave him and three about his death.
-- The first is origin story. The others are grief, and a fan asking the ask box
-- about André could get them back.
--
-- The vault already lets an artist reject a SOURCE. Nothing let them reject
-- something pulled out of their own words, which is the more personal of the
-- two.
--
-- KEYED ON THE QUOTE, NOT ON THE ROW. A full re-read clears artist_social_credits
-- and writes it again, so a flag on the row would be erased by the next refresh
-- and the artist would have to hide the same passage every time. The quote is
-- lifted verbatim from the caption, so it survives.

CREATE TABLE IF NOT EXISTS artist_hidden_statements (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    artist_id   uuid NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
    -- Lowercased, letters and digits only. Compared against statements the same
    -- way, so re-extraction that re-punctuates the same passage still matches.
    quote_norm  text NOT NULL,
    -- Kept for the UI, so a hidden item can say which post it came from.
    source_url  text,
    hidden_at   timestamptz NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
    CONSTRAINT artist_hidden_statements_quote_not_empty CHECK (length(quote_norm) > 0)
);

-- Hiding the same passage twice is a no-op rather than a second row.
CREATE UNIQUE INDEX IF NOT EXISTS artist_hidden_statements_unique
    ON artist_hidden_statements (artist_id, quote_norm);

-- Read on every getSocialCredits, which is every ask.
CREATE INDEX IF NOT EXISTS artist_hidden_statements_by_artist
    ON artist_hidden_statements (artist_id);

-- The GRANT is not optional. A policy filters rows only AFTER Postgres has
-- checked table-level privilege, so RLS without this denies everything to the
-- non-superuser role the app connects as — the mistake 0018 shipped with, which
-- passed on dev only because dev had default privileges.
GRANT SELECT, INSERT, UPDATE, DELETE ON artist_hidden_statements TO mnweb;

ALTER TABLE artist_hidden_statements ENABLE ROW LEVEL SECURITY;

CREATE POLICY mnweb_select_artist_hidden_statements ON artist_hidden_statements
    AS PERMISSIVE FOR SELECT TO mnweb USING (true);
CREATE POLICY mnweb_insert_artist_hidden_statements ON artist_hidden_statements
    AS PERMISSIVE FOR INSERT TO mnweb WITH CHECK (true);
CREATE POLICY mnweb_update_artist_hidden_statements ON artist_hidden_statements
    AS PERMISSIVE FOR UPDATE TO mnweb USING (true) WITH CHECK (true);
CREATE POLICY mnweb_delete_artist_hidden_statements ON artist_hidden_statements
    AS PERMISSIVE FOR DELETE TO mnweb USING (true);
