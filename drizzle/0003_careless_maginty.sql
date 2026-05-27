CREATE TABLE "mcp_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"key_hash" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "mcp_api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
ALTER TABLE "mcp_api_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mcp_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v4() NOT NULL,
	"artist_id" uuid NOT NULL,
	"field" text NOT NULL,
	"action" text NOT NULL,
	"submitted_url" text,
	"old_value" text,
	"new_value" text,
	"api_key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "legacy_link_dismissed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_audit_log" ADD CONSTRAINT "mcp_audit_log_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_mcp_audit_log_artist_id" ON "mcp_audit_log" USING btree ("artist_id" uuid_ops);--> statement-breakpoint
CREATE POLICY "mnweb_select_mcp_api_keys" ON "mcp_api_keys" AS PERMISSIVE FOR SELECT TO "mnweb" USING (true);--> statement-breakpoint
CREATE POLICY "mnweb_insert_mcp_api_keys" ON "mcp_api_keys" AS PERMISSIVE FOR INSERT TO "mnweb" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "mnweb_update_mcp_api_keys" ON "mcp_api_keys" AS PERMISSIVE FOR UPDATE TO "mnweb";--> statement-breakpoint
CREATE POLICY "mnweb_select_mcp_audit_log" ON "mcp_audit_log" AS PERMISSIVE FOR SELECT TO "mnweb" USING (true);--> statement-breakpoint
CREATE POLICY "mnweb_insert_mcp_audit_log" ON "mcp_audit_log" AS PERMISSIVE FOR INSERT TO "mnweb" WITH CHECK (true);
