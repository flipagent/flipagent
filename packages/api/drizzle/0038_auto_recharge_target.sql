-- Auto-recharge: collapse `threshold` + `topup` into a single `target`
-- column. Trigger logic moves from "fire when balance < threshold,
-- charge `topup` credits" to "fire when balance < target, charge
-- `target - balance` credits (Stripe-min-bounded)". One UX input
-- instead of two; matches how Vercel / AWS expose auto-top-up.
--
-- Existing users: `target = threshold + topup` (the post-recharge
-- balance their old config implicitly aimed for) so behaviour stays
-- close to what they configured.

ALTER TABLE "user" ADD COLUMN "auto_recharge_target" integer;

UPDATE "user"
SET "auto_recharge_target" = "auto_recharge_threshold" + "auto_recharge_topup"
WHERE "auto_recharge_threshold" IS NOT NULL
  AND "auto_recharge_topup" IS NOT NULL;

ALTER TABLE "user" DROP COLUMN "auto_recharge_threshold";
ALTER TABLE "user" DROP COLUMN "auto_recharge_topup";
