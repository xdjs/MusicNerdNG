ALTER TABLE "artist_bio_versions" DROP CONSTRAINT "artist_bio_versions_artist_id_fkey";
--> statement-breakpoint
ALTER TABLE "artist_bio_versions" ADD CONSTRAINT "artist_bio_versions_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;