CREATE TABLE "listing_durations" (
	"item_id" text PRIMARY KEY NOT NULL,
	"listed_at" timestamp with time zone,
	"sold_at" timestamp with time zone,
	"duration_days_x100" integer,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fetch_attempts" integer DEFAULT 0 NOT NULL,
	"fetch_failed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX "listing_durations_fetched_at_idx" ON "listing_durations" USING btree ("fetched_at");