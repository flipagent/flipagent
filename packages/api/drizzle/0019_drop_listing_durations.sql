-- Drop listing_durations cache table. Schema (`listingDurations` const +
-- types) was removed alongside `services/listings/durations.ts` after
-- the per-listing time-to-sell cache was retired — duration data now
-- comes via the comparable observation pipeline (Browse
-- itemCreationDate / itemEndDate populated lazily on detail fetches).
-- Original creation in 0004_listing_durations.
DROP INDEX IF EXISTS "listing_durations_fetched_at_idx";
DROP TABLE IF EXISTS "listing_durations";
