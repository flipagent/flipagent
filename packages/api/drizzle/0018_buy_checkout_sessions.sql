-- Buy Order checkout sessions — bridge-mode backing for
-- /v1/buy/order/checkout_session/*. Two-step flow: `initiate` writes
-- a row here; `place_order` creates a row in purchase_orders and
-- links it via purchase_order_id.

CREATE TYPE "buy_checkout_session_status" AS ENUM ('created', 'placed', 'expired');

CREATE TABLE IF NOT EXISTS "buy_checkout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"api_key_id" uuid NOT NULL REFERENCES "api_keys"("id") ON DELETE CASCADE,
	"user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
	"line_items" jsonb NOT NULL,
	"shipping_addresses" jsonb,
	"payment_instruments" jsonb,
	"pricing_summary" jsonb,
	"status" "buy_checkout_session_status" NOT NULL DEFAULT 'created',
	"purchase_order_id" uuid REFERENCES "purchase_orders"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"expires_at" timestamp with time zone NOT NULL,
	"placed_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "buy_checkout_sessions_api_key_idx" ON "buy_checkout_sessions" ("api_key_id", "created_at");
CREATE INDEX IF NOT EXISTS "buy_checkout_sessions_expires_idx" ON "buy_checkout_sessions" ("expires_at");
