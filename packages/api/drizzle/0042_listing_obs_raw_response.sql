-- Promote `listing_observations` from "analytics lake" to "lake + cache"
-- by stashing the full normalised ItemDetail body alongside the indexed
-- denormalised columns. Detail-fetch rows populate `raw_response`;
-- search-result rows leave it NULL. Reads use `WHERE legacy_item_id=?
-- AND raw_response IS NOT NULL ORDER BY observed_at DESC LIMIT 1` to
-- find the latest fresh detail snapshot — replaces the proxy cache for
-- this resource.

ALTER TABLE "listing_observations" ADD COLUMN "raw_response" jsonb;
ALTER TABLE "listing_observations" ADD COLUMN "source" text;

-- Partial index for the cache-lookup hot path: only detail rows with a
-- raw_response participate, keeping the index small.
CREATE INDEX "listing_obs_raw_response_idx"
  ON "listing_observations" ("legacy_item_id", "observed_at" DESC)
  WHERE "raw_response" IS NOT NULL AND "takedown_at" IS NULL;
