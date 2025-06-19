CREATE TABLE IF NOT EXISTS "coverage_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"repository" varchar(255) NOT NULL,
	"branch" varchar(255) NOT NULL,
	"commit_sha" varchar(40) NOT NULL,
	"workflow_run_id" varchar(50),
	"coverage_data" jsonb NOT NULL,
	"total_coverage" numeric(5,2),
	"lines_covered" integer,
	"lines_total" integer,
	"functions_covered" integer,
	"functions_total" integer,
	"branches_covered" integer,
	"branches_total" integer,
	"statements_covered" integer,
	"statements_total" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS "coverage_repository_idx" ON "coverage_reports" ("repository");
CREATE INDEX IF NOT EXISTS "coverage_branch_idx" ON "coverage_reports" ("branch");
CREATE INDEX IF NOT EXISTS "coverage_commit_idx" ON "coverage_reports" ("commit_sha");
CREATE INDEX IF NOT EXISTS "coverage_created_at_idx" ON "coverage_reports" ("created_at"); 