-- Catalog: flipagent-native Product DB. Cross-marketplace by design —
-- a Product is the canonical SKU we trade in, with marketplace listings
-- (eBay today; StockX / Mercari / GOAT next) attached as observations.
-- Variants cover sized/coloured sub-units (sneakers, clothes, bags);
-- conditions stay on the listing observation, sliced at digest time.
--
-- Identifiers index lets external keys (eBay epid, GTIN, MPN, StockX id)
-- resolve to a Product+variant in one indexed lookup. listing_observations
-- gets product_id / variant_id columns so the existing data lake links to
-- the catalog without a parallel table.
--
-- compute_jobs gets a typed (subject_kind, subject_id) so dedup/attach
-- queries become indexed lookups instead of `params->>'itemId'` JSON
-- probes — and so an evaluate run and an appraise run on the same
-- product converge to the same leader.

-- pg_trgm powers fuzzy title/brand lookup in catalog/match.ts.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"brand" text,
	"model_number" text,
	"category_path" text,
	"catalog_status" text NOT NULL DEFAULT 'auto',
	"attributes" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"has_variants" boolean NOT NULL DEFAULT false,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	"takedown_at" timestamp with time zone,
	CONSTRAINT "products_catalog_status_chk" CHECK ("catalog_status" IN ('curated', 'auto', 'pending'))
);--> statement-breakpoint

CREATE INDEX "products_status_idx" ON "products" ("catalog_status");--> statement-breakpoint
CREATE INDEX "products_takedown_idx" ON "products" ("takedown_at");--> statement-breakpoint
CREATE INDEX "products_title_trgm_idx" ON "products" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "products_brand_trgm_idx" ON "products" USING gin ("brand" gin_trgm_ops);--> statement-breakpoint

CREATE TABLE "product_variants" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL REFERENCES "products"("id") ON DELETE cascade,
	-- Canonical key: lower-cased aspect names, alpha-sorted, '|' separated.
	-- Examples: 'size:10', 'color:mocha|size:10', 'grade:psa_9'.
	"variant_key" text NOT NULL,
	"attributes" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX "product_variants_key_unique" ON "product_variants" ("product_id", "variant_key");--> statement-breakpoint

-- External-system → flipagent product/variant lookup. One row per
-- (marketplace, kind, value) — globally unique because external keys
-- (epid, gtin, mpn, stockx id) are themselves unique within their
-- namespace. Variant-level rows attach to a specific variant; product-
-- level rows leave variant_id NULL.
CREATE TABLE "product_identifiers" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"product_id" text NOT NULL REFERENCES "products"("id") ON DELETE cascade,
	"variant_id" text REFERENCES "product_variants"("id") ON DELETE cascade,
	-- 'ebay_us' | 'stockx' | 'goat' | 'mercari_jp' | 'global' (gtin/mpn).
	"marketplace" text NOT NULL,
	-- 'epid' | 'gtin' | 'mpn' | 'sku' | 'stockx_id' | 'goat_id'.
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"added_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX "product_identifiers_external_unique" ON "product_identifiers" ("marketplace", "kind", "value");--> statement-breakpoint
CREATE INDEX "product_identifiers_product_idx" ON "product_identifiers" ("product_id");--> statement-breakpoint
CREATE INDEX "product_identifiers_variant_idx" ON "product_identifiers" ("variant_id") WHERE "variant_id" IS NOT NULL;--> statement-breakpoint

-- Link the existing raw-listing lake to the catalog. Nullable until the
-- catalog resolver runs against the row; backfill happens lazily as
-- evaluate / appraise traffic flows through the resolver.
ALTER TABLE "listing_observations" ADD COLUMN "product_id" text REFERENCES "products"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "listing_observations" ADD COLUMN "variant_id" text REFERENCES "product_variants"("id") ON DELETE set null;--> statement-breakpoint

CREATE INDEX "listing_obs_product_idx" ON "listing_observations" ("product_id", "observed_at" DESC) WHERE "product_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "listing_obs_variant_idx" ON "listing_observations" ("variant_id", "observed_at" DESC) WHERE "variant_id" IS NOT NULL;--> statement-breakpoint

-- Typed subject pointer on compute_jobs. Replaces the params->>'itemId'
-- JSON probe in findInProgressUpstreamJob and lets evaluate + appraise
-- attach to the same leader when they target the same product.
--   subject_kind ∈ ('product', 'listing', 'ingest_marketplace', …)
--   subject_id   = the catalog product_id, the marketplace listing key,
--                  or whatever the kind defines.
ALTER TABLE "compute_jobs" ADD COLUMN "subject_kind" text;--> statement-breakpoint
ALTER TABLE "compute_jobs" ADD COLUMN "subject_id" text;--> statement-breakpoint

CREATE INDEX "compute_jobs_subject_idx" ON "compute_jobs" ("subject_kind", "subject_id", "status") WHERE "subject_kind" IS NOT NULL;
