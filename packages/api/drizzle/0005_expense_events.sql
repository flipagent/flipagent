CREATE TYPE "public"."expense_event_kind" AS ENUM('purchased', 'forwarder_fee', 'expense');--> statement-breakpoint
CREATE TABLE "expense_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expense_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"api_key_id" uuid NOT NULL,
	"kind" "expense_event_kind" NOT NULL,
	"sku" text NOT NULL,
	"marketplace" text DEFAULT 'ebay_us' NOT NULL,
	"external_id" text,
	"amount_cents" integer NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb
);
--> statement-breakpoint
ALTER TABLE "expense_events" ADD CONSTRAINT "expense_events_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_events_api_key_time_idx" ON "expense_events" USING btree ("api_key_id","occurred_at");--> statement-breakpoint
CREATE INDEX "expense_events_api_key_sku_idx" ON "expense_events" USING btree ("api_key_id","sku");--> statement-breakpoint
ALTER TABLE "expense_events" ADD CONSTRAINT "expense_events_amount_cents_check" CHECK ("amount_cents" >= 0);
