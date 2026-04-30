-- Server-side compute job queue. Backs `/v1/evaluate/jobs/*` and
-- `/v1/discover/jobs/*` so a tab close mid-run doesn't lose the result
-- and the user can cancel cooperatively. Distinct from `bridge_jobs`
-- (which targets the user's Chrome extension); these run inside the
-- API process against eBay scrape + LLM filter.

CREATE TYPE "public"."compute_job_kind" AS ENUM('evaluate', 'discover');--> statement-breakpoint
CREATE TYPE "public"."compute_job_status" AS ENUM('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint

CREATE TABLE "compute_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_key_id" uuid NOT NULL,
	"user_id" text,
	"kind" "compute_job_kind" NOT NULL,
	"status" "compute_job_status" DEFAULT 'queued' NOT NULL,
	"params" jsonb NOT NULL,
	"trace" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result" jsonb,
	"error_code" text,
	"error_message" text,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "compute_jobs_api_key_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "compute_jobs_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint

CREATE INDEX "compute_jobs_api_key_idx" ON "compute_jobs" USING btree ("api_key_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX "compute_jobs_status_idx" ON "compute_jobs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "compute_jobs_expires_idx" ON "compute_jobs" USING btree ("expires_at");
