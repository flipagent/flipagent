/**
 * Drizzle migration runner — defensive variant that does NOT trust the
 * `when` timestamp ordering in `meta/_journal.json`.
 *
 * Why we replaced `drizzle-orm/postgres-js/migrator`:
 * stock drizzle picks `max(created_at)` from `drizzle.__drizzle_migrations`
 * and only applies a journal entry whose `folderMillis` (`when`) is
 * *greater* than that max. If the journal is ever non-monotonic — which
 * happens when a migration is regenerated after newer ones already exist,
 * or when `when` is hand-edited — drizzle silently SKIPS the older entries
 * and reports "migrations done". The DB ends up missing tables/columns and
 * the only signal is a runtime SQL error days/weeks later. Lost a chunk
 * of time to that exact failure mode (0033–0037 + 0039 silently skipped
 * in prod despite "migrations done") — never again.
 *
 * Skip decision here: a journal entry is considered applied iff either its
 * `tag` (filename) OR its file SHA-256 is already recorded in
 * `__drizzle_migrations`. Tag-match makes us tolerant of content edits to
 * already-applied migrations; hash-match makes us tolerant of `tag` /
 * `when` edits (or rows from the stock drizzle era that pre-date the `tag`
 * column being added). Either way, ordering / monotonicity of `when` is
 * irrelevant — we read the full applied set up front and decide per entry.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { config } from "../config.js";

interface JournalEntry {
	idx: number;
	tag: string;
	when: number;
	breakpoints?: boolean;
	version?: string;
}

interface Journal {
	entries: JournalEntry[];
}

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(here, "..", "..", "drizzle");

async function main() {
	const redacted = config.DATABASE_URL.replace(/:[^:@]+@/, ":***@");
	console.log(`migrating ${redacted}`);

	const journal = JSON.parse(await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8")) as Journal;

	// Heads-up only — this runner doesn't care, but stock drizzle does, so
	// flag non-monotonic journals so they get cleaned up before someone
	// invokes the stock migrator and trips the silent-skip footgun.
	let prevWhen = -1;
	for (const e of journal.entries) {
		if (e.when < prevWhen) {
			console.warn(
				`[journal] non-monotonic 'when': ${e.tag} (${e.when}) < previous max (${prevWhen}). ` +
					`Stock drizzle migrator would silently skip; this runner is tag/hash-based so safe, ` +
					`but please normalize the timestamp.`,
			);
		}
		prevWhen = Math.max(prevWhen, e.when);
	}

	const queue: { entry: JournalEntry; sql: string; hash: string }[] = [];
	for (const entry of journal.entries) {
		const sql = await readFile(join(migrationsFolder, `${entry.tag}.sql`), "utf8");
		const hash = createHash("sha256").update(sql).digest("hex");
		queue.push({ entry, sql, hash });
	}

	const client = postgres(config.DATABASE_URL, { max: 1 });
	try {
		// Idempotent ledger setup so a fresh DB works without ever invoking
		// the stock drizzle migrator.
		await client.unsafe(`CREATE SCHEMA IF NOT EXISTS drizzle`);
		await client.unsafe(`
			CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
				id SERIAL PRIMARY KEY,
				hash text NOT NULL,
				created_at bigint
			)
		`);
		// `tag` is our addition. Stock drizzle never writes it; we backfill
		// for legacy rows below by matching on created_at or hash.
		await client.unsafe(`
			ALTER TABLE drizzle.__drizzle_migrations
			ADD COLUMN IF NOT EXISTS tag text
		`);

		// Backfill tag on legacy rows. Two-pass match:
		//   1. created_at == journal.when (precise, fast)
		//   2. hash equality (covers `when` edits / regenerated journal)
		// Both run as UPDATE WHERE tag IS NULL so already-tagged rows are
		// untouched, and any row that matches multiple journal entries by
		// created_at (shouldn't happen — `when` values are unique) just gets
		// the first matching tag.
		for (const { entry, hash } of queue) {
			await client`
				UPDATE drizzle.__drizzle_migrations
				SET tag = ${entry.tag}
				WHERE tag IS NULL
					AND (created_at = ${entry.when} OR hash = ${hash})
			`;
		}

		const rows = await client<{ tag: string | null; hash: string }[]>`
			SELECT tag, hash FROM drizzle.__drizzle_migrations
		`;
		const appliedTags = new Set(rows.map((r) => r.tag).filter((t): t is string => !!t));
		const appliedHashes = new Set(rows.map((r) => r.hash));

		const pending = queue.filter((q) => !appliedTags.has(q.entry.tag) && !appliedHashes.has(q.hash));

		if (pending.length === 0) {
			console.log("nothing to apply");
		} else {
			console.log(`applying ${pending.length} migration(s)`);
			// Single transaction across all pending so a partial-apply
			// rolls back cleanly. Statements that can't run in a transaction
			// (CREATE INDEX CONCURRENTLY, etc.) must live in a separate
			// migration file with its own runner — none in this repo today.
			await client.begin(async (tx) => {
				for (const { entry, sql, hash } of pending) {
					console.log(`  ${entry.tag}`);
					for (const stmt of sql.split("--> statement-breakpoint")) {
						const trimmed = stmt.trim();
						if (trimmed.length === 0) continue;
						await tx.unsafe(trimmed);
					}
					await tx`
						INSERT INTO drizzle.__drizzle_migrations (hash, created_at, tag)
						VALUES (${hash}, ${entry.when}, ${entry.tag})
					`;
				}
			});
		}
	} finally {
		await client.end({ timeout: 5 });
	}
	console.log("migrations done");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
