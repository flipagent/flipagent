CREATE TABLE "bridge_captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_key_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"url" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- credit_grants.idempotency_key already added in 0032_credits_lifecycle.sql; drizzle's snapshot diff re-emitted it from a stale state.
ALTER TABLE "usage_events" ADD COLUMN "credits_charged" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "tier" "api_key_tier" DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "past_due_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "auto_recharge_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "auto_recharge_threshold" integer;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "auto_recharge_topup" integer;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "last_auto_recharge_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bridge_captures" ADD CONSTRAINT "bridge_captures_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_captures_api_key_item_unique" ON "bridge_captures" USING btree ("api_key_id","item_id");--> statement-breakpoint
CREATE INDEX "bridge_captures_captured_at_idx" ON "bridge_captures" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX "usage_events_user_tier_created_idx" ON "usage_events" USING btree ("user_id","tier","created_at");