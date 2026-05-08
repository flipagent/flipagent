-- Cross-marketplace MarketView cache. Replaces `market_data_cache`
-- (which keyed on `(item_id, lookback_days, sold_limit)` — listing-
-- specific). The new cache keys on `(product_id, variant_id?,
-- lookback_days, sold_limit)`, so two listings of the same SKU resolve
-- to the same product → same cache entry. Real cross-listing dedup.
--
-- No backward compat: the legacy table is dropped. Cache is purely
-- opportunistic (12h TTL); worst case is a few hours of misses post-
-- deploy.
--
-- Also extends `compute_job_kind` with `appraise` — the new composite
-- worth-check surface that runs the same MarketView pipeline as
-- evaluate but skips the buy-decision scoring layer.

ALTER TYPE "compute_job_kind" ADD VALUE IF NOT EXISTS 'appraise';--> statement-breakpoint

DROP TABLE IF EXISTS "market_data_cache";--> statement-breakpoint

CREATE TABLE "product_market_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" text NOT NULL REFERENCES "products"("id") ON DELETE cascade,
	-- NULL when the product has no variants (or the digest is the
	-- product-level aggregate).
	"variant_id" text REFERENCES "product_variants"("id") ON DELETE cascade,
	"lookback_days" integer NOT NULL,
	"sold_limit" integer NOT NULL,
	-- Full MarketView digest. Includes byCondition + byVariant slices
	-- pre-computed so condition / variant comparison views are free.
	"digest" jsonb NOT NULL,
	"source_job_id" uuid REFERENCES "compute_jobs"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"expires_at" timestamp with time zone NOT NULL
);--> statement-breakpoint

-- Distinct unique indexes for variant / no-variant rows so NULL
-- variant_id participates in uniqueness exactly once per product.
CREATE UNIQUE INDEX "product_market_cache_key_variant"
	ON "product_market_cache" ("product_id", "variant_id", "lookback_days", "sold_limit")
	WHERE "variant_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "product_market_cache_key_product"
	ON "product_market_cache" ("product_id", "lookback_days", "sold_limit")
	WHERE "variant_id" IS NULL;--> statement-breakpoint

CREATE INDEX "product_market_cache_expires_idx" ON "product_market_cache" ("expires_at");
