-- Match artist_bio_versions: artist_vault_sources.artist_id should cascade on artist
-- deletion. The previous NO ACTION setting would either block artist deletion (FK
-- violation) or orphan vault rows in any path that bypasses the FK check.
DO $$
DECLARE
	fk_delete_action "char";
BEGIN
	SELECT confdeltype INTO fk_delete_action
	FROM pg_constraint
	WHERE conname = 'artist_vault_sources_artist_id_fkey'
		AND conrelid = 'public.artist_vault_sources'::regclass;

	IF fk_delete_action IS NULL THEN
		ALTER TABLE "artist_vault_sources" ADD CONSTRAINT "artist_vault_sources_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;
	ELSIF fk_delete_action <> 'c' THEN
		ALTER TABLE "artist_vault_sources" DROP CONSTRAINT "artist_vault_sources_artist_id_fkey";
		ALTER TABLE "artist_vault_sources" ADD CONSTRAINT "artist_vault_sources_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
