-- Migrate `marketplace` from provider-only ("ebay") to provider+region
-- combined ("ebay_us"). Updates default + back-fills existing rows.
-- The bridge_jobs.source column stays as "ebay" — that's a separate
-- bridge-source enum (ebay | planetexpress | control | browser | ebay_data),
-- not a marketplace dispatch literal.

ALTER TABLE "listing_observations" ALTER COLUMN "marketplace" SET DEFAULT 'ebay_us';--> statement-breakpoint
UPDATE "listing_observations" SET "marketplace" = 'ebay_us' WHERE "marketplace" = 'ebay';--> statement-breakpoint

ALTER TABLE "product_observations" ALTER COLUMN "marketplace" SET DEFAULT 'ebay_us';--> statement-breakpoint
UPDATE "product_observations" SET "marketplace" = 'ebay_us' WHERE "marketplace" = 'ebay';--> statement-breakpoint

ALTER TABLE "category_snapshots" ALTER COLUMN "marketplace" SET DEFAULT 'ebay_us';--> statement-breakpoint
UPDATE "category_snapshots" SET "marketplace" = 'ebay_us' WHERE "marketplace" = 'ebay';--> statement-breakpoint

ALTER TABLE "marketplace_notifications" ALTER COLUMN "marketplace" SET DEFAULT 'ebay_us';--> statement-breakpoint
UPDATE "marketplace_notifications" SET "marketplace" = 'ebay_us' WHERE "marketplace" = 'ebay';
