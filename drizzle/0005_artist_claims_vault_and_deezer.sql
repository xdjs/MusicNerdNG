DO $$ BEGIN
	CREATE TYPE "public"."claim_status" AS ENUM('pending', 'approved', 'rejected');
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	CREATE TYPE "public"."source_status" AS ENUM('pending', 'approved', 'rejected');
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TYPE "public"."claim_status" ADD VALUE IF NOT EXISTS 'rejected';
--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN IF NOT EXISTS "custom_image" text;
--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN IF NOT EXISTS "deezer" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artist_claims" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"user_id" uuid NOT NULL,
	"artist_id" uuid NOT NULL,
	"status" "claim_status" DEFAULT 'pending' NOT NULL,
	"reference_code" text,
	"created_at" timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
	CONSTRAINT "artist_claims_artist_id_key" UNIQUE("artist_id")
);
--> statement-breakpoint
ALTER TABLE "artist_claims" ADD COLUMN IF NOT EXISTS "reference_code" text;
--> statement-breakpoint
ALTER TABLE "artist_claims" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artist_vault_sources" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"artist_id" uuid NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"snippet" text,
	"type" text,
	"status" "source_status" DEFAULT 'pending' NOT NULL,
	"file_name" text,
	"file_size" integer,
	"file_path" text,
	"content_type" text,
	"extracted_text" text,
	"og_image" text,
	"created_at" timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artist_vault_sources" ADD COLUMN IF NOT EXISTS "file_name" text;
--> statement-breakpoint
ALTER TABLE "artist_vault_sources" ADD COLUMN IF NOT EXISTS "file_size" integer;
--> statement-breakpoint
ALTER TABLE "artist_vault_sources" ADD COLUMN IF NOT EXISTS "file_path" text;
--> statement-breakpoint
ALTER TABLE "artist_vault_sources" ADD COLUMN IF NOT EXISTS "content_type" text;
--> statement-breakpoint
ALTER TABLE "artist_vault_sources" ADD COLUMN IF NOT EXISTS "extracted_text" text;
--> statement-breakpoint
ALTER TABLE "artist_vault_sources" ADD COLUMN IF NOT EXISTS "og_image" text;
--> statement-breakpoint
ALTER TABLE "artist_vault_sources" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artist_bio_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"artist_id" uuid NOT NULL,
	"bio_text" text NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artist_bio_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'artist_claims_user_id_fkey'
			AND conrelid = 'public.artist_claims'::regclass
	) THEN
		ALTER TABLE "artist_claims" ADD CONSTRAINT "artist_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'artist_claims_artist_id_fkey'
			AND conrelid = 'public.artist_claims'::regclass
	) THEN
		ALTER TABLE "artist_claims" ADD CONSTRAINT "artist_claims_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'artist_vault_sources_artist_id_fkey'
			AND conrelid = 'public.artist_vault_sources'::regclass
	) THEN
		ALTER TABLE "artist_vault_sources" ADD CONSTRAINT "artist_vault_sources_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$
DECLARE
	fk_delete_action "char";
BEGIN
	SELECT confdeltype INTO fk_delete_action
	FROM pg_constraint
	WHERE conname = 'artist_bio_versions_artist_id_fkey'
		AND conrelid = 'public.artist_bio_versions'::regclass;

	IF fk_delete_action IS NULL THEN
		ALTER TABLE "artist_bio_versions" ADD CONSTRAINT "artist_bio_versions_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;
	ELSIF fk_delete_action <> 'c' THEN
		ALTER TABLE "artist_bio_versions" DROP CONSTRAINT "artist_bio_versions_artist_id_fkey";
		ALTER TABLE "artist_bio_versions" ADD CONSTRAINT "artist_bio_versions_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_artist_claims_user_id" ON "artist_claims" USING btree ("user_id" uuid_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_artist_claims_artist_id" ON "artist_claims" USING btree ("artist_id" uuid_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_artist_vault_sources_artist_id" ON "artist_vault_sources" USING btree ("artist_id" uuid_ops);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "artists_deezer_uniq" ON "artists" USING btree ("deezer" text_ops) WHERE (deezer IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_artist_bio_versions_artist_id" ON "artist_bio_versions" USING btree ("artist_id" uuid_ops);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'artist_claims' AND policyname = 'mnweb_delete_artist_claims') THEN
		CREATE POLICY "mnweb_delete_artist_claims" ON "artist_claims" AS PERMISSIVE FOR DELETE TO "mnweb" USING (true);
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'artist_claims' AND policyname = 'mnweb_insert_artist_claims') THEN
		CREATE POLICY "mnweb_insert_artist_claims" ON "artist_claims" AS PERMISSIVE FOR INSERT TO "mnweb";
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'artist_claims' AND policyname = 'mnweb_select_artist_claims') THEN
		CREATE POLICY "mnweb_select_artist_claims" ON "artist_claims" AS PERMISSIVE FOR SELECT TO "mnweb";
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'artist_claims' AND policyname = 'mnweb_update_artist_claims') THEN
		CREATE POLICY "mnweb_update_artist_claims" ON "artist_claims" AS PERMISSIVE FOR UPDATE TO "mnweb";
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'artist_vault_sources' AND policyname = 'mnweb_delete_artist_vault_sources') THEN
		CREATE POLICY "mnweb_delete_artist_vault_sources" ON "artist_vault_sources" AS PERMISSIVE FOR DELETE TO "mnweb" USING (true);
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'artist_vault_sources' AND policyname = 'mnweb_insert_artist_vault_sources') THEN
		CREATE POLICY "mnweb_insert_artist_vault_sources" ON "artist_vault_sources" AS PERMISSIVE FOR INSERT TO "mnweb";
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'artist_vault_sources' AND policyname = 'mnweb_select_artist_vault_sources') THEN
		CREATE POLICY "mnweb_select_artist_vault_sources" ON "artist_vault_sources" AS PERMISSIVE FOR SELECT TO "mnweb";
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'artist_vault_sources' AND policyname = 'mnweb_update_artist_vault_sources') THEN
		CREATE POLICY "mnweb_update_artist_vault_sources" ON "artist_vault_sources" AS PERMISSIVE FOR UPDATE TO "mnweb";
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'artist_bio_versions' AND policyname = 'mnweb_select_artist_bio_versions') THEN
		CREATE POLICY "mnweb_select_artist_bio_versions" ON "artist_bio_versions" AS PERMISSIVE FOR SELECT TO "mnweb" USING (true);
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'artist_bio_versions' AND policyname = 'mnweb_insert_artist_bio_versions') THEN
		CREATE POLICY "mnweb_insert_artist_bio_versions" ON "artist_bio_versions" AS PERMISSIVE FOR INSERT TO "mnweb";
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'artist_bio_versions' AND policyname = 'mnweb_update_artist_bio_versions') THEN
		CREATE POLICY "mnweb_update_artist_bio_versions" ON "artist_bio_versions" AS PERMISSIVE FOR UPDATE TO "mnweb";
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'artist_bio_versions' AND policyname = 'mnweb_delete_artist_bio_versions') THEN
		CREATE POLICY "mnweb_delete_artist_bio_versions" ON "artist_bio_versions" AS PERMISSIVE FOR DELETE TO "mnweb" USING (true);
	END IF;
END $$;
