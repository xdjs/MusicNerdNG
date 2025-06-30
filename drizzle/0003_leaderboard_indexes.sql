-- adds indexes to speed up leaderboard counts
CREATE INDEX IF NOT EXISTS idx_artists_added_by ON artists(added_by);
CREATE INDEX IF NOT EXISTS idx_ugcresearch_user_id ON ugcresearch(user_id); 