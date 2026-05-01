ALTER TABLE "compute_jobs" ADD COLUMN IF NOT EXISTS "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "compute_jobs" ADD COLUMN IF NOT EXISTS "claimed_by" text;--> statement-breakpoint
ALTER TABLE "compute_jobs" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "compute_jobs" ADD COLUMN IF NOT EXISTS "checkpoints" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compute_jobs_claim_idx" ON "compute_jobs" USING btree ("status","lease_until","created_at");
