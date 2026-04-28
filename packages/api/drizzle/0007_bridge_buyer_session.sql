ALTER TABLE "bridge_tokens"
	ADD COLUMN "buyer_logged_in" boolean DEFAULT false NOT NULL,
	ADD COLUMN "buyer_ebay_user_name" text,
	ADD COLUMN "buyer_verified_at" timestamp with time zone;
