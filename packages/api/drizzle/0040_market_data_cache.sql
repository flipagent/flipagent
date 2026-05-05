-- Cross-user upstream cache for the evaluate pipeline. Stores the
-- assembled digest (item + sold pool + active pool + same-product LLM
-- filter + market stats) keyed on `(item_id, lookback_days, sold_limit)`.
-- Per-user scoring runs on top and lands in `compute_jobs.result` as a
-- self-contained snapshot — this table is the dedup/cache layer below.
--
-- Concurrency: simultaneous fetchers race on the unique index; the
-- second INSERT loses with `ON CONFLICT DO NOTHING` (one redundant
-- fetch is cheaper than coordinating an advisory lock). Subsequent
-- requests within the TTL window hit the cached row.
--
-- Takedown: `/v1/takedown` approval deletes by `item_id`; the takedown
-- blocklist short-circuits any re-fetch.

CREATE TABLE "market_data_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" text NOT NULL,
	"lookback_days" integer NOT NULL,
	"sold_limit" integer NOT NULL,
	"digest" jsonb NOT NULL,
	"source_job_id" uuid REFERENCES "compute_jobs"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"expires_at" timestamp with time zone NOT NULL
);

CREATE UNIQUE INDEX "market_data_cache_key" ON "market_data_cache" ("item_id", "lookback_days", "sold_limit");
CREATE INDEX "market_data_cache_expires_idx" ON "market_data_cache" ("expires_at");
