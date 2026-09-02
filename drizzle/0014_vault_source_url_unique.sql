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
