-- Per-row credit accounting + tier-at-time, past-due lifecycle, credit-pack idempotency.
--
-- Shifts billing from a hand-synced SQL CASE expression in
-- snapshotUsage() to a persisted `credits_charged` column written at
-- request time. Lets us:
--   - sum a plain integer instead of CASE (keeps snapshotUsage cheap as
--     usage_events grows, and lets us add transport-aware variable pricing
--     without another schema bump),
--   - record `tier` at the moment of the call so a free user who upgrades
--     to hobby and back doesn't get a fresh 500-credit lifetime window
--     (snapshotUsage filters by tier='free' on the free aggregation),
--   - record `source` (rest/scrape/bridge/trading/llm) for analytics +
--     post-hoc cost reconstruction.
--
-- `user.past_due_since` is set on the first invoice.payment_failed and
-- cleared when the subscription returns to active. After a 7-day grace
-- the snapshot middleware downgrades the effective tier to free without
-- touching `user.tier` (kept truthful for billing — only the rate-limit
-- view changes), so we don't keep serving paid-tier capacity to a card
-- that's been failing for two weeks of Stripe dunning.
--
-- `credit_grants.idempotency_key` is the Stripe checkout session id
-- when a grant comes from a credit-pack purchase — lets the webhook
-- safely no-op on Stripe's at-least-once redelivery.

ALTER TABLE "usage_events" ADD COLUMN "credits_charged" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "tier" "api_key_tier" NOT NULL DEFAULT 'free';--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "source" text;--> statement-breakpoint

-- Backfill credits_charged from the same prefix table the runtime used.
-- Runs once (rows added after this migration are written with the
-- correct value at insert time).
UPDATE "usage_events" SET "credits_charged" = CASE
	WHEN "endpoint" LIKE '/v1/evaluate/featured%' THEN 0
	WHEN "endpoint" LIKE '/v1/evaluate/scopes%' THEN 0
	WHEN "endpoint" LIKE '/v1/evaluate%' THEN 50
	WHEN "endpoint" LIKE '/v1/items%' THEN 1
	WHEN "endpoint" LIKE '/v1/products%' THEN 1
	WHEN "endpoint" LIKE '/v1/categories%' THEN 1
	WHEN "endpoint" LIKE '/v1/trends%' THEN 1
	ELSE 0
END;--> statement-breakpoint

-- Backfill tier from the owning api_keys row. For events whose key was
-- since revoked or deleted this still works (FK is ON DELETE CASCADE,
-- so the row would be gone if the key were); the join is safe.
UPDATE "usage_events"
SET "tier" = "api_keys"."tier"
FROM "api_keys"
WHERE "usage_events"."api_key_id" = "api_keys"."id";--> statement-breakpoint

-- Per-tier credit aggregation index. snapshotUsage on free filters by
-- tier='free', so this composite is the hot path for the lifetime free
-- counter.
CREATE INDEX IF NOT EXISTS "usage_events_user_tier_created_idx" ON "usage_events" ("user_id", "tier", "created_at");--> statement-breakpoint

ALTER TABLE "user" ADD COLUMN "past_due_since" timestamp with time zone;--> statement-breakpoint

-- Auto-recharge config. Three columns + a stamp:
--   auto_recharge_enabled  : top-up on / off
--   auto_recharge_threshold: credits-remaining trigger (e.g. 1000)
--   auto_recharge_topup    : credits to buy each trigger (e.g. 25000)
--   last_auto_recharge_at  : guards against double-fire — middleware
--                            only triggers if last attempt > 60s ago
-- Threshold + topup are nullable while enabled is false; the api
-- enforces "enabled IMPLIES both set" at the route boundary so we
-- don't need a CHECK constraint here. Card-on-file comes from the
-- user's existing subscription (Stripe stores it as
-- customer.invoice_settings.default_payment_method on first checkout).
ALTER TABLE "user" ADD COLUMN "auto_recharge_enabled" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "auto_recharge_threshold" integer;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "auto_recharge_topup" integer;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "last_auto_recharge_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "credit_grants" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
-- Partial unique index — credit-pack grants carry the Stripe session id;
-- admin grants leave it null (no dedup needed). NULLs are not unique by
-- default in pg, but the explicit WHERE clause makes the intent obvious
-- + lets the index stay small.
CREATE UNIQUE INDEX IF NOT EXISTS "credit_grants_idempotency_unique" ON "credit_grants" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL;
