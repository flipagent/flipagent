-- Drop watchlist + deal_queue tables. The Overnight pillar (saved
-- query sweeps + queued deals) was retired ahead of a rebuild around
-- product-anchored item watching; the table-shape didn't survive the
-- redesign. Original creation in 0014_overnight; unique-name change in
-- 0016_rename_deal_queue_unique.
DROP INDEX IF EXISTS "deal_queue_owner_status_idx";
DROP INDEX IF EXISTS "watchlists_owner_idx";
DROP TABLE IF EXISTS "deal_queue";
DROP TABLE IF EXISTS "watchlists";
DROP TYPE IF EXISTS "deal_queue_status";
DROP TYPE IF EXISTS "watchlist_cadence";
