CREATE TABLE "artist_social_posts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"artist_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"platform_post_id" text NOT NULL,
	"owner_username" text NOT NULL,
	"is_own_post" boolean NOT NULL,
	"caption" text,
	"url" text NOT NULL,
	"posted_at" timestamp with time zone,
	"like_count" integer,
	"comment_count" integer,
	"play_count" integer,
	"hashtags" text[] DEFAULT '{}' NOT NULL,
	"mentions" text[] DEFAULT '{}' NOT NULL,
	"coauthors" text[] DEFAULT '{}' NOT NULL,
	"music_title" text,
	"music_artist" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
	CONSTRAINT "artist_social_posts_artist_platform_post_uniq" UNIQUE("artist_id","platform","platform_post_id")
);
--> statement-breakpoint
ALTER TABLE "artist_social_posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "artist_social_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"artist_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"handle" text NOT NULL,
	"followers_count" integer,
	"bio" text,
	"avatar_url" text,
	"scraped_at" timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
	CONSTRAINT "artist_social_profiles_artist_platform_uniq" UNIQUE("artist_id","platform")
);
--> statement-breakpoint
ALTER TABLE "artist_social_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "artist_social_posts" ADD CONSTRAINT "artist_social_posts_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_social_profiles" ADD CONSTRAINT "artist_social_profiles_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_artist_social_posts_artist_id" ON "artist_social_posts" USING btree ("artist_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_artist_social_posts_own" ON "artist_social_posts" USING btree ("artist_id","is_own_post");--> statement-breakpoint
CREATE INDEX "idx_artist_social_profiles_artist_id" ON "artist_social_profiles" USING btree ("artist_id" uuid_ops);--> statement-breakpoint
CREATE POLICY "mnweb_select_artist_social_posts" ON "artist_social_posts" AS PERMISSIVE FOR SELECT TO "mnweb" USING (true);--> statement-breakpoint
CREATE POLICY "mnweb_insert_artist_social_posts" ON "artist_social_posts" AS PERMISSIVE FOR INSERT TO "mnweb" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "mnweb_update_artist_social_posts" ON "artist_social_posts" AS PERMISSIVE FOR UPDATE TO "mnweb" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "mnweb_delete_artist_social_posts" ON "artist_social_posts" AS PERMISSIVE FOR DELETE TO "mnweb" USING (true);--> statement-breakpoint
CREATE POLICY "mnweb_select_artist_social_profiles" ON "artist_social_profiles" AS PERMISSIVE FOR SELECT TO "mnweb" USING (true);--> statement-breakpoint
CREATE POLICY "mnweb_insert_artist_social_profiles" ON "artist_social_profiles" AS PERMISSIVE FOR INSERT TO "mnweb" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "mnweb_update_artist_social_profiles" ON "artist_social_profiles" AS PERMISSIVE FOR UPDATE TO "mnweb" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "mnweb_delete_artist_social_profiles" ON "artist_social_profiles" AS PERMISSIVE FOR DELETE TO "mnweb" USING (true);