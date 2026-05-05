-- Promote search from "sync REST handler" to "first-class operation"
-- by recording every search under compute_jobs (kind='search'). Same
-- table as evaluate, same `GET /v1/jobs` history endpoint, same
-- per-apiKey scope — one cross-surface activity log.
--
-- Search runs sync (in the API container, not the worker), so the
-- queue/lease/heartbeat columns stay NULL on search rows. The status
-- machine collapses to `running → completed | failed` in the same
-- request handler.

ALTER TYPE "compute_job_kind" ADD VALUE 'search';
