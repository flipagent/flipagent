CREATE TYPE "public"."purchase_order_status" AS ENUM('queued', 'claimed', 'awaiting_user_confirm', 'placing', 'completed', 'failed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'delivered', 'failed');--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_key_id" uuid NOT NULL,
	"user_id" text,
	"source" text DEFAULT 'ebay' NOT NULL,
	"item_id" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"max_price_cents" integer,
	"status" "purchase_order_status" DEFAULT 'queued' NOT NULL,
	"ebay_order_id" text,
	"total_cents" integer,
	"receipt_url" text,
	"failure_reason" text,
	"metadata" jsonb,
	"idempotency_key" text,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_by_token_id" uuid,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_api_key_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "purchase_orders_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "purchase_orders_api_key_idx" ON "purchase_orders" USING btree ("api_key_id","created_at");--> statement-breakpoint
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_idem_unique" ON "purchase_orders" USING btree ("api_key_id","idempotency_key");--> statement-breakpoint
CREATE TABLE "bridge_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_key_id" uuid NOT NULL,
	"user_id" text,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"device_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "bridge_tokens_api_key_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "bridge_tokens_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bridge_tokens_hash_unique" ON "bridge_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "bridge_tokens_api_key_idx" ON "bridge_tokens" USING btree ("api_key_id");--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_key_id" uuid NOT NULL,
	"user_id" text,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" text[] NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_delivery_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "webhook_endpoints_api_key_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "webhook_endpoints_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "webhook_endpoints_api_key_idx" ON "webhook_endpoints" USING btree ("api_key_id");--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "webhook_deliveries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"endpoint_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"response_status" integer,
	"response_body" text,
	"next_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "webhook_deliveries_endpoint_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_idx" ON "webhook_deliveries" USING btree ("endpoint_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_next_retry_idx" ON "webhook_deliveries" USING btree ("status","next_retry_at");
