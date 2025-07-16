-- Add index on spotify column for better search performance
CREATE INDEX IF NOT EXISTS idx_artists_spotify ON artists(spotify) WHERE spotify IS NOT NULL;

-- Add composite index for search optimization
CREATE INDEX IF NOT EXISTS idx_artists_lcname_spotify ON artists(lcname, spotify) WHERE spotify IS NOT NULL; 