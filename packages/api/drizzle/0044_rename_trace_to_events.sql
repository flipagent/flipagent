-- Rename `compute_jobs.trace` → `compute_jobs.events`. The column now
-- stores both step lifecycle events (started/succeeded/failed) and
-- typed `partial` state-hydration events; "trace" was a holdover from
-- when only step events lived here. "events" is the honest name —
-- "every event the pipeline emitted in arrival order".
--
-- Pure rename: data unchanged, no backfill, no downtime.

ALTER TABLE compute_jobs RENAME COLUMN trace TO events;
