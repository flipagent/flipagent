-- Drop the unused 'discover' value from compute_job_kind. Postgres
-- can't remove enum values directly, so we recreate the type. There
-- should be no rows with kind='discover' (the route was never
-- exposed); the DELETE below is belt-and-suspenders.

DELETE FROM "compute_jobs" WHERE "kind" = 'discover';--> statement-breakpoint
ALTER TYPE "compute_job_kind" RENAME TO "compute_job_kind_old";--> statement-breakpoint
CREATE TYPE "compute_job_kind" AS ENUM ('evaluate');--> statement-breakpoint
ALTER TABLE "compute_jobs" ALTER COLUMN "kind" TYPE "compute_job_kind" USING "kind"::text::"compute_job_kind";--> statement-breakpoint
DROP TYPE "compute_job_kind_old";
