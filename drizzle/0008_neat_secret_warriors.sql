-- IF NOT EXISTS (deviates from Drizzle's default): the `subvert` column was applied
-- to production manually via the Supabase SQL editor ahead of this migration, so this
-- statement must be idempotent to avoid a "column already exists" error when the
-- tracked migrate process runs against prod. See docs/superpowers/specs/2026-07-24-add-subvert-platform-design.md.
ALTER TABLE "artists" ADD COLUMN IF NOT EXISTS "subvert" text;