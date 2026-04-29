-- Rename the auto-named UNIQUE constraint on deal_queue to match the
-- explicit name declared in the drizzle schema (`unique("deal_queue_
-- watchlist_item_unique")`). Original 0014 migration omitted the name,
-- so Postgres assigned `deal_queue_watchlist_id_legacy_item_id_status_
-- key`. Renaming keeps schema and DB in sync without requiring a
-- drop-and-recreate (which would race with active inserts).
ALTER TABLE "deal_queue"
	RENAME CONSTRAINT "deal_queue_watchlist_id_legacy_item_id_status_key"
	TO "deal_queue_watchlist_item_unique";
