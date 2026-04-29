-- Overnight pillar — saved sweeps + queued deals + approval state.
-- Each row scoped to an api_key (multi-tenant by definition); deletes
-- cascade to deal_queue so a removed watchlist doesn't leave orphan
-- pending deals around.

CREATE TYPE "watchlist_cadence" AS ENUM ('hourly', 'every_6h', 'daily');
CREATE TYPE "deal_queue_status" AS ENUM ('pending', 'approved', 'dismissed', 'expired');

CREATE TABLE IF NOT EXISTS "watchlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"api_key_id" uuid NOT NULL REFERENCES "api_keys"("id") ON DELETE CASCADE,
	"name" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"cadence" "watchlist_cadence" NOT NULL DEFAULT 'daily',
	"enabled" boolean NOT NULL DEFAULT true,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	"last_run_at" timestamp with time zone,
	"last_run_error" text
);

CREATE INDEX IF NOT EXISTS "watchlists_owner_idx" ON "watchlists" ("api_key_id");
CREATE INDEX IF NOT EXISTS "watchlists_due_idx" ON "watchlists" ("enabled", "last_run_at")
	WHERE "enabled" = true;

CREATE TABLE IF NOT EXISTS "deal_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"watchlist_id" uuid NOT NULL REFERENCES "watchlists"("id") ON DELETE CASCADE,
	"api_key_id" uuid NOT NULL REFERENCES "api_keys"("id") ON DELETE CASCADE,
	"legacy_item_id" text NOT NULL,
	"item_snapshot" jsonb NOT NULL,
	"evaluation_snapshot" jsonb NOT NULL,
	"status" "deal_queue_status" NOT NULL DEFAULT 'pending',
	"item_web_url" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	-- Idempotency: one pending row per (watchlist, item). New scans won't
	-- duplicate; stale rows can be re-inserted only after the prior row's
	-- status moves out of 'pending'.
	UNIQUE ("watchlist_id", "legacy_item_id", "status")
);

CREATE INDEX IF NOT EXISTS "deal_queue_owner_status_idx"
	ON "deal_queue" ("api_key_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "deal_queue_pending_notify_idx"
	ON "deal_queue" ("api_key_id", "notified_at")
	WHERE "status" = 'pending';
