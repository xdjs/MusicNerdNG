-- Replace the hard UNIQUE on artist_claims.artist_id with a partial unique index
-- that only fires when status IN ('pending', 'approved'). This:
--   (a) Preserves rejected-claim history (we no longer have to hard-delete a rejected
--       row before another user can re-claim — addressing the previous loss of audit trail).
--   (b) Still blocks two concurrent active claims for the same artist (correctness).
-- Same pattern used by `artists_spotify_uniq`.
DO $$ BEGIN
	IF EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'artist_claims_artist_id_key'
			AND conrelid = 'public.artist_claims'::regclass
	) THEN
		ALTER TABLE "artist_claims" DROP CONSTRAINT "artist_claims_artist_id_key";
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "artist_claims_artist_id_active_uniq"
	ON "artist_claims" USING btree ("artist_id" uuid_ops)
	WHERE status IN ('pending', 'approved');
