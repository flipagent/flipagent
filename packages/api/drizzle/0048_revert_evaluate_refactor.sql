-- Roll back 0046_catalog + 0047_market_view_cache. The catalog/products
-- refactor that landed earlier today turned out to be premature; the
-- code is reverted (services/products/, services/market-data/, the
-- evaluate ProductRef union, the Worth/appraise playground tab) and the
-- DB shape needs to match.
--
-- Idempotent on purpose: prod was already cleaned by hand via az+psql
-- (`DROP TABLE products` + friends + `compute_jobs.subject_*` columns +
-- the `appraise` enum value swap) before this migration shipped, so
-- every statement here uses IF EXISTS / IF NOT EXISTS guards. Local
-- dev DBs that ran 0046+0047 will see the same end state once this
-- runs; fresh DBs go 0046 → 0047 → 0048 and converge identically.
--
-- Catalog mirror surface (the `/v1/marketplaces/ebay/catalog/*` route
-- + the new flipagent-shape catalog types) gets removed alongside.
-- The single eBay-required compliance endpoint
-- (/v1/ebay/notifications/account-deletion) stays — it's path-pinned by
-- the eBay developer portal and unrelated to the refactor.

-- 1) listing_observations: drop columns + indexes added by 0046_catalog
DROP INDEX IF EXISTS "listing_obs_product_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "listing_obs_variant_idx";--> statement-breakpoint
ALTER TABLE "listing_observations" DROP COLUMN IF EXISTS "product_id";--> statement-breakpoint
ALTER TABLE "listing_observations" DROP COLUMN IF EXISTS "variant_id";--> statement-breakpoint

-- 2) Drop new catalog/products surface (4 tables added by 0046+0047)
DROP TABLE IF EXISTS "product_market_cache";--> statement-breakpoint
DROP TABLE IF EXISTS "product_identifiers";--> statement-breakpoint
DROP TABLE IF EXISTS "product_variants";--> statement-breakpoint
DROP TABLE IF EXISTS "products" CASCADE;--> statement-breakpoint

-- 3) compute_jobs: drop subject_kind/subject_id columns + index (0046)
DROP INDEX IF EXISTS "compute_jobs_subject_idx";--> statement-breakpoint
ALTER TABLE "compute_jobs" DROP COLUMN IF EXISTS "subject_kind";--> statement-breakpoint
ALTER TABLE "compute_jobs" DROP COLUMN IF EXISTS "subject_id";--> statement-breakpoint

-- 4) Recreate market_data_cache (0047 dropped it; the old shape from
--    0040_market_data_cache is restored verbatim).
CREATE TABLE IF NOT EXISTS "market_data_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" text NOT NULL,
	"lookback_days" integer NOT NULL,
	"sold_limit" integer NOT NULL,
	"digest" jsonb NOT NULL,
	"source_job_id" uuid REFERENCES "compute_jobs"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"expires_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "market_data_cache_key"
	ON "market_data_cache" ("item_id", "lookback_days", "sold_limit");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_data_cache_expires_idx"
	ON "market_data_cache" ("expires_at");--> statement-breakpoint

-- 5) Strip 'appraise' from compute_job_kind enum. Postgres has no native
--    drop-value; the legal way is to rebuild the enum and re-bind every
--    column that uses it. Only compute_jobs.kind references it. No rows
--    currently use 'appraise' so the cast can't lose data.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM pg_enum e
		JOIN pg_type t ON e.enumtypid = t.oid
		WHERE t.typname = 'compute_job_kind' AND e.enumlabel = 'appraise'
	) THEN
		CREATE TYPE "compute_job_kind_v2" AS ENUM ('evaluate', 'search');
		ALTER TABLE "compute_jobs"
			ALTER COLUMN "kind" TYPE "compute_job_kind_v2"
			USING "kind"::text::"compute_job_kind_v2";
		DROP TYPE "compute_job_kind";
		ALTER TYPE "compute_job_kind_v2" RENAME TO "compute_job_kind";
	END IF;
END $$;--> statement-breakpoint

-- 6) Drop pg_trgm extension (only used by the products trgm indexes
--    we just dropped; nothing else references it).
DROP EXTENSION IF EXISTS "pg_trgm";
