-- Forwarder inventory — per-package lifecycle row that the bridge
-- reconciles into. Each PE package the user holds gets one row;
-- refresh upserts (on packageId), photos / dispatch update fields,
-- and the listing flow links the row to a marketplace sku + offerId
-- so the sold-event handler can find it without the agent threading
-- the linkage by hand.
--
-- Status flow (forward-only; out-of-order updates are tolerated and
-- the column just reflects the latest known state):
--   received → photographed → listed → sold → dispatched → shipped

CREATE TYPE "forwarder_inventory_status" AS ENUM (
	'received',
	'photographed',
	'listed',
	'sold',
	'dispatched',
	'shipped'
);

CREATE TABLE IF NOT EXISTS "forwarder_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"api_key_id" uuid NOT NULL REFERENCES "api_keys"("id") ON DELETE CASCADE,
	"provider" text NOT NULL,
	"package_id" text NOT NULL,
	"sku" text,
	"ebay_offer_id" text,
	"ebay_inbound_order_id" text,
	"status" "forwarder_inventory_status" NOT NULL DEFAULT 'received',
	-- Captured at intake by the forwarder. Array of `{ url, capturedAt?, caption? }`.
	"photos" jsonb,
	-- Measured at intake. Used by /v1/draft and /v1/ship/quote.
	"weight_g" integer,
	"dims_cm" jsonb,
	-- Inbound — what brought the package to PE. Stored for provenance
	-- + so a future refresh-vs-purchase reconciler can match without
	-- a separate expected_inbounds table.
	"inbound_tracking" text,
	-- Outbound — set when dispatch completes.
	"outbound_shipment_id" text,
	"outbound_carrier" text,
	"outbound_tracking" text,
	"outbound_cost_cents" integer,
	"outbound_label_url" text,
	"shipped_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- One row per (api key, provider, packageId) — refresh upserts on this.
CREATE UNIQUE INDEX IF NOT EXISTS "forwarder_inventory_pkg_unique"
	ON "forwarder_inventory" ("api_key_id", "provider", "package_id");

-- Auto-dispatch on sold notification looks up by sku.
CREATE INDEX IF NOT EXISTS "forwarder_inventory_sku_idx"
	ON "forwarder_inventory" ("api_key_id", "sku")
	WHERE "sku" IS NOT NULL;

-- Inventory list endpoints scan by api key, newest first.
CREATE INDEX IF NOT EXISTS "forwarder_inventory_api_key_idx"
	ON "forwarder_inventory" ("api_key_id", "created_at");
