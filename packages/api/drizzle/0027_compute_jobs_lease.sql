ALTER TABLE "compute_jobs" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "compute_jobs" ADD COLUMN "claimed_by" text;--> statement-breakpoint
ALTER TABLE "compute_jobs" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "compute_jobs" ADD COLUMN "checkpoints" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "compute_jobs_claim_idx" ON "compute_jobs" USING btree ("status","lease_until","created_at");