-- Enable the pg_trgm extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create GiST index for trigram search on name
CREATE INDEX artists_name_trgm_idx ON artists USING gist (name gist_trgm_ops);

-- Create GiST index for trigram search on lcname
CREATE INDEX artists_lcname_trgm_idx ON artists USING gist (lcname gist_trgm_ops); 