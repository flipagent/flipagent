-- Phase 2 — per-category elasticity calibration. Nightly job regresses
-- duration vs price-z over listing_observations and writes the fitted β
-- here. categoryBeta() reads from this table when present, falls back to
-- the hardcoded map otherwise. Hosted-only — self-host stays on defaults.
CREATE TABLE IF NOT EXISTS "category_calibration" (
	"category_id" text PRIMARY KEY,
	"beta_estimate" numeric NOT NULL,
	"n_observations" integer NOT NULL,
	"fit_quality" numeric,
	"last_fit_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Phase 3 — anonymized query frequency per hour × category. Drives the
-- /v1/trends/categories surface ("which categories are heating up right
-- now"). query_hash is a stable anon hash of the search keyword set so
-- we don't store cross-user query content as text.
CREATE TABLE IF NOT EXISTS "query_pulse" (
	"hour_bucket" timestamp with time zone NOT NULL,
	"category_id" text NOT NULL DEFAULT '',
	"query_hash" text NOT NULL DEFAULT '',
	"query_count" integer NOT NULL DEFAULT 0,
	PRIMARY KEY ("hour_bucket", "category_id", "query_hash")
);

CREATE INDEX IF NOT EXISTS "query_pulse_category_idx"
	ON "query_pulse" ("category_id", "hour_bucket");

-- Phase 4 — per-pair match decision cache. Pass-2 of the LLM matcher
-- checks (candidate_id, item_id) here first; cache hit → skip LLM call.
-- TTL 30 days because eBay listings expire and seller intent shifts —
-- old "match" decisions go stale eventually. Decision is canonical so
-- a candidate evaluated against the same item next week gets the same
-- bucket without paying the inference cost.
CREATE TABLE IF NOT EXISTS "match_decisions" (
	"candidate_id" text NOT NULL,
	"item_id" text NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"decided_at" timestamp with time zone NOT NULL DEFAULT now(),
	"expires_at" timestamp with time zone NOT NULL,
	PRIMARY KEY ("candidate_id", "item_id")
);

CREATE INDEX IF NOT EXISTS "match_decisions_expires_idx"
	ON "match_decisions" ("expires_at");
