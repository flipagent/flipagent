ALTER TABLE "user" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "terms_accepted_ip" text;--> statement-breakpoint
ALTER TABLE "user_ebay_oauth" ADD COLUMN "disclaimer_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_ebay_oauth" ADD COLUMN "disclaimer_version" text;