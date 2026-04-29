-- Calibration traces from delegate-mode /v1/match callers.
-- Two-row lifecycle: 'pending' (request time, candidate + pool snapshot)
-- → 'completed' (caller posts host-LLM decisions to /v1/traces/match).
-- Anonymised by design — no api_key foreign key, only a short SHA-256
-- prefix for per-key rate-limit accounting.

CREATE TABLE IF NOT EXISTS "match_traces" (
	"trace_id" uuid PRIMARY KEY,
	"candidate_id" text NOT NULL,
	"pool_item_ids" jsonb NOT NULL,
	"candidate_snapshot" jsonb NOT NULL,
	"pool_snapshot" jsonb NOT NULL,
	"use_images" boolean NOT NULL DEFAULT true,
	"status" text NOT NULL DEFAULT 'pending',
	"decisions" jsonb,
	"llm_model" text,
	"client_version" text,
	"api_key_hash_prefix" text,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"completed_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "match_traces_status_idx" ON "match_traces" ("status");
CREATE INDEX IF NOT EXISTS "match_traces_created_idx" ON "match_traces" ("created_at");
