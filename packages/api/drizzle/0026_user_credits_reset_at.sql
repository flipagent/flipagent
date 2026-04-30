-- Per-user "current tier credit epoch" — the timestamp from which the
-- current tier's credit budget starts counting. Without this, a Standard
-- user who used 100k credits this month and then cancels would land back
-- on Free with their pre-downgrade events still counted against Free's
-- lifetime 500-credit cap (since Free is a one-time grant, snapshotUsage
-- aggregates events all-time when oneTime=true). The epoch lets us scope
-- counting to "since you became your current tier."
--
-- Update path: Stripe webhook bumps this whenever the user's tier
-- transitions (created / updated / deleted subscriptions). Signup gets
-- defaultNow() automatically.
--
-- Backfill: existing rows take their `created_at` so a user who's been
-- Free since signup has a sensible epoch (== signup), not 1970.

ALTER TABLE "user"
	ADD COLUMN "credits_reset_at" timestamptz NOT NULL DEFAULT now();--> statement-breakpoint

UPDATE "user" SET "credits_reset_at" = "created_at" WHERE "credits_reset_at" >= "created_at";
