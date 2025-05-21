-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

-- Convert name column to citext
ALTER TABLE artists ALTER COLUMN name TYPE citext;

-- Create GIN index for trigram search on name
CREATE INDEX artists_name_trgm_idx ON artists USING gin (name gin_trgm_ops);

-- Create GiST index for trigram search on lcname
CREATE INDEX artists_lcname_trgm_idx ON artists USING gist (lcname gist_trgm_ops); 