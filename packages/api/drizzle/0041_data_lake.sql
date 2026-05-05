-- Three append-only data-lake tables for ML iteration + cross-user
-- dedup. They sit *alongside* the existing runtime caches:
--
--   match_history          ↔ match_decisions  (cache 30d → archive forever)
--   product_observations   ↔ proxy_response_cache  (cache 4h → archive forever)
--   category_snapshots     ↔ in-memory tree id cache  (change-only)
--
-- Reproducibility: pair these with `listing_observations` (already
-- existing) to reconstruct what any pipeline saw at decision time.

CREATE TABLE "match_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"candidate_id" text NOT NULL,
	"item_id" text NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"category" text,
	"model_id" text,
	"observed_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "match_history_pair_idx" ON "match_history" ("candidate_id", "item_id", "observed_at" DESC);
CREATE INDEX "match_history_model_time_idx" ON "match_history" ("model_id", "observed_at");

CREATE TABLE "product_observations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"marketplace" text NOT NULL DEFAULT 'ebay',
	"epid" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL DEFAULT now(),
	"snapshot" jsonb NOT NULL,
	"source" text NOT NULL,
	"takedown_at" timestamp with time zone
);

CREATE INDEX "product_observations_epid_observed_idx" ON "product_observations" ("epid", "observed_at" DESC);

CREATE TABLE "category_snapshots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"marketplace" text NOT NULL DEFAULT 'ebay',
	"root" text NOT NULL,
	"hash" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "category_snapshots_root_observed_idx" ON "category_snapshots" ("marketplace", "root", "observed_at" DESC);
