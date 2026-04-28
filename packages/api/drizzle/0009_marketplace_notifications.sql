ALTER TYPE "expense_event_kind" ADD VALUE IF NOT EXISTS 'sold';

CREATE TABLE IF NOT EXISTS "marketplace_notifications" (
	"id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	"api_key_id" uuid REFERENCES "api_keys"("id") ON DELETE SET NULL,
	"marketplace" text NOT NULL DEFAULT 'ebay',
	"event_type" text NOT NULL,
	"recipient_user_id" text,
	"external_id" text,
	"signature_valid" boolean NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone NOT NULL DEFAULT now(),
	"processed_at" timestamp with time zone,
	"process_error" text,
	CONSTRAINT "marketplace_notifications_dedupe_unique" UNIQUE ("marketplace", "dedupe_key")
);

CREATE INDEX IF NOT EXISTS "marketplace_notifications_api_key_time_idx"
	ON "marketplace_notifications" ("api_key_id", "received_at");

CREATE INDEX IF NOT EXISTS "marketplace_notifications_event_idx"
	ON "marketplace_notifications" ("marketplace", "event_type", "received_at");
