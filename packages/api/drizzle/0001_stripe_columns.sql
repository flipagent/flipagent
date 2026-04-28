ALTER TABLE "api_keys" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "subscription_status" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_stripe_sub_idx" ON "api_keys" USING btree ("stripe_subscription_id");