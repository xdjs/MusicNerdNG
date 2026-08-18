CREATE TABLE "artist_docs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"artist_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
	CONSTRAINT "artist_docs_artist_id_key" UNIQUE("artist_id")
);
--> statement-breakpoint
ALTER TABLE "artist_docs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "artist_interview_answers" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"artist_id" uuid NOT NULL,
	"question_key" text NOT NULL,
	"question" text NOT NULL,
	"answer" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
	CONSTRAINT "artist_interview_answers_artist_question_uniq" UNIQUE("artist_id","question_key")
);
--> statement-breakpoint
ALTER TABLE "artist_interview_answers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "artist_onboarding_steps" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"artist_id" uuid NOT NULL,
	"step" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT (now() AT TIME ZONE 'utc'::text) NOT NULL,
	CONSTRAINT "artist_onboarding_steps_artist_step_uniq" UNIQUE("artist_id","step")
);
--> statement-breakpoint
ALTER TABLE "artist_onboarding_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "artist_docs" ADD CONSTRAINT "artist_docs_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_interview_answers" ADD CONSTRAINT "artist_interview_answers_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_onboarding_steps" ADD CONSTRAINT "artist_onboarding_steps_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_artist_interview_answers_artist_id" ON "artist_interview_answers" USING btree ("artist_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_artist_onboarding_steps_artist_id" ON "artist_onboarding_steps" USING btree ("artist_id" uuid_ops);--> statement-breakpoint
CREATE POLICY "mnweb_select_artist_docs" ON "artist_docs" AS PERMISSIVE FOR SELECT TO "mnweb" USING (true);--> statement-breakpoint
CREATE POLICY "mnweb_insert_artist_docs" ON "artist_docs" AS PERMISSIVE FOR INSERT TO "mnweb" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "mnweb_update_artist_docs" ON "artist_docs" AS PERMISSIVE FOR UPDATE TO "mnweb" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "mnweb_delete_artist_docs" ON "artist_docs" AS PERMISSIVE FOR DELETE TO "mnweb" USING (true);--> statement-breakpoint
CREATE POLICY "mnweb_select_artist_interview_answers" ON "artist_interview_answers" AS PERMISSIVE FOR SELECT TO "mnweb" USING (true);--> statement-breakpoint
CREATE POLICY "mnweb_insert_artist_interview_answers" ON "artist_interview_answers" AS PERMISSIVE FOR INSERT TO "mnweb" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "mnweb_update_artist_interview_answers" ON "artist_interview_answers" AS PERMISSIVE FOR UPDATE TO "mnweb" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "mnweb_delete_artist_interview_answers" ON "artist_interview_answers" AS PERMISSIVE FOR DELETE TO "mnweb" USING (true);--> statement-breakpoint
CREATE POLICY "mnweb_select_artist_onboarding_steps" ON "artist_onboarding_steps" AS PERMISSIVE FOR SELECT TO "mnweb" USING (true);--> statement-breakpoint
CREATE POLICY "mnweb_insert_artist_onboarding_steps" ON "artist_onboarding_steps" AS PERMISSIVE FOR INSERT TO "mnweb" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "mnweb_delete_artist_onboarding_steps" ON "artist_onboarding_steps" AS PERMISSIVE FOR DELETE TO "mnweb" USING (true);