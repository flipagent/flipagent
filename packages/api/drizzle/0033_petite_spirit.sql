-- 0033 only adds the `bridge_captures` table — every other ALTER /
-- index in this file's drizzle-snapshot diff was already shipped in
-- 0032_credits_lifecycle.sql (drizzle's auto-snapshot was diffed
-- against a stale schema reference, so it re-emitted live columns as
-- "new"). Applying those a second time trips PG 42701 column-already-
-- exists on a fresh DB. Keep just the genuinely new bridge_captures
-- DDL here.
CREATE TABLE "bridge_captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_key_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"url" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bridge_captures" ADD CONSTRAINT "bridge_captures_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_captures_api_key_item_unique" ON "bridge_captures" USING btree ("api_key_id","item_id");--> statement-breakpoint
CREATE INDEX "bridge_captures_captured_at_idx" ON "bridge_captures" USING btree ("captured_at");
