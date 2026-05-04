ALTER TABLE "bridge_tokens" ADD COLUMN "pe_logged_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bridge_tokens" ADD COLUMN "pe_verified_at" timestamp with time zone;