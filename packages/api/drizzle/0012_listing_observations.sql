CREATE TABLE IF NOT EXISTS "listing_observations" (
	"id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	"marketplace" text NOT NULL DEFAULT 'ebay',
	"legacy_item_id" text NOT NULL,
	"item_id" text,
	"observed_at" timestamp with time zone NOT NULL DEFAULT now(),
	"source_query_hash" text,
	"item_web_url" text NOT NULL,
	"title" text,
	"condition" text,
	"condition_id" text,
	"price_cents" integer,
	"currency" text DEFAULT 'USD',
	"shipping_cents" integer,
	"last_sold_price_cents" integer,
	"last_sold_date" timestamp with time zone,
	"seller_username" text,
	"seller_feedback_score" integer,
	"seller_feedback_percentage" text,
	"category_id" text,
	"category_path" text,
	"image_url" text,
	"aspects" jsonb,
	"item_creation_date" timestamp with time zone,
	"item_end_date" timestamp with time zone,
	"takedown_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "listing_obs_legacy_idx"
	ON "listing_observations" ("marketplace", "legacy_item_id", "observed_at");

CREATE INDEX IF NOT EXISTS "listing_obs_category_idx"
	ON "listing_observations" ("category_id", "observed_at");

CREATE INDEX IF NOT EXISTS "listing_obs_seller_idx"
	ON "listing_observations" ("seller_username", "observed_at");

CREATE INDEX IF NOT EXISTS "listing_obs_takedown_idx"
	ON "listing_observations" ("takedown_at");

CREATE INDEX IF NOT EXISTS "listing_obs_sold_date_idx"
	ON "listing_observations" ("last_sold_date");
