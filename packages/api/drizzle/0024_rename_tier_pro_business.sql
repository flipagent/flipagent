-- Rename tier enum values to match the public-facing brand names:
--   pro      → standard   ($99/mo)
--   business → growth     ($399/mo)
-- The hobby and free values keep their names. Existing api_keys rows + user
-- rows referencing the old values are remapped automatically by Postgres —
-- ALTER TYPE RENAME VALUE rewrites the enum entry, not the rows.
--
-- Existing API keys with prefix `fa_pro_xxx` keep working: lookup is by
-- sha256(plaintext) (auth/keys.ts:findActiveKey), the prefix is display-only.
-- New keys issued after this migration will read `fa_standard_xxx` /
-- `fa_growth_xxx`.

ALTER TYPE "public"."api_key_tier" RENAME VALUE 'pro' TO 'standard';--> statement-breakpoint
ALTER TYPE "public"."api_key_tier" RENAME VALUE 'business' TO 'growth';
