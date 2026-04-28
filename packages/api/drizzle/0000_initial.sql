CREATE TYPE "public"."takedown_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."api_key_tier" AS ENUM('free', 'hobby', 'pro', 'business');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"tier" "api_key_tier" DEFAULT 'free' NOT NULL,
	"name" text,
	"owner_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "listings_cache" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "listings_cache_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source" text DEFAULT 'ebay_us' NOT NULL,
	"source_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"condition" text,
	"price_cents" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"shipping_cents" integer,
	"buying_format" text,
	"bid_count" integer,
	"watch_count" integer,
	"seller_id" text,
	"seller_feedback" integer,
	"end_time" timestamp with time zone,
	"raw_json" jsonb,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "price_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "price_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"keyword" text NOT NULL,
	"marketplace" text DEFAULT 'EBAY_US' NOT NULL,
	"title" text NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"shipping_cents" integer,
	"condition" text,
	"url" text,
	"sold_at" timestamp with time zone,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proxy_response_cache" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "proxy_response_cache_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"path" text NOT NULL,
	"query_hash" text NOT NULL,
	"body" jsonb NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "takedown_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" text NOT NULL,
	"reason" text,
	"contact_email" text NOT NULL,
	"status" "takedown_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "usage_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "usage_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"api_key_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"status_code" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_key_hash_unique" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_owner_email_idx" ON "api_keys" USING btree ("owner_email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "listings_source_unique" ON "listings_cache" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_title_idx" ON "listings_cache" USING btree ("title");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_history_keyword_idx" ON "price_history" USING btree ("keyword","marketplace");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_history_sold_at_idx" ON "price_history" USING btree ("sold_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "proxy_cache_path_query_unique" ON "proxy_response_cache" USING btree ("path","query_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proxy_cache_expires_idx" ON "proxy_response_cache" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "takedown_item_idx" ON "takedown_requests" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "takedown_status_idx" ON "takedown_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_key_created_idx" ON "usage_events" USING btree ("api_key_id","created_at");