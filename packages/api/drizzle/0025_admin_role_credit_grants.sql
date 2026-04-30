-- Operator role on `user` + append-only credit-grant ledger.
--
-- 1) `user_role` enum + `user.role` column. Defaults to 'user'; admins are
--    promoted via the ADMIN_EMAILS env list (better-auth databaseHook +
--    requireSession reconcile call). New column is NOT NULL with a default,
--    so the table rewrite is fast — Postgres just stamps the default for
--    existing rows.
--
-- 2) `credit_grants` ledger. Each row adjusts the user's monthly credit
--    budget by `credits_delta` (positive bonus, negative clawback) for as
--    long as it isn't revoked and isn't past `expires_at`. Append-only:
--    revocations write `revoked_at` + `revoked_by_user_id`, never delete.
--    `snapshotUsage` (auth/limits.ts) sums active rows and adds them to
--    TIER_LIMITS[tier].creditsPerMonth.

CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint

ALTER TABLE "user" ADD COLUMN "role" "user_role" DEFAULT 'user' NOT NULL;--> statement-breakpoint

CREATE TABLE "credit_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"credits_delta" integer NOT NULL,
	"reason" text NOT NULL,
	"granted_by_user_id" text,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" text,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_grants_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "credit_grants_granted_by_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action,
	CONSTRAINT "credit_grants_revoked_by_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint

CREATE INDEX "credit_grants_user_idx" ON "credit_grants" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_grants_active_idx" ON "credit_grants" USING btree ("user_id","revoked_at","expires_at");
