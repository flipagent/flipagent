/**
 * In-process watchlist scheduler. The api server kicks one of these
 * up at boot when `WATCHLIST_SCHEDULER_ENABLED=1`. Every tick, it pulls
 * a small batch of due watchlists, runs `runWatchlistScan` on each
 * sequentially (limits LLM-pool concurrency), and goes back to sleep.
 *
 * Single-process tick is fine while the api stays at min_replicas=1
 * (the same posture as `MIGRATE_ON_BOOT`); multi-replica calls for
 * Postgres advisory locks or `SELECT … FOR UPDATE SKIP LOCKED` to keep
 * two replicas from running the same watchlist at once. Defer until
 * we actually scale beyond one box.
 */

import { config } from "../../config.js";
import { sendDigestEmails } from "./digest.js";
import { expireStaleDealQueueRows, pickDueWatchlists, runWatchlistScan } from "./scan.js";

const TICK_INTERVAL_MS = 60 * 1000; // every minute — picks at most 5 due watchlists
const DIGEST_INTERVAL_MS = 60 * 60 * 1000; // hourly digest sweep

let tickHandle: ReturnType<typeof setInterval> | null = null;
let digestHandle: ReturnType<typeof setInterval> | null = null;
let ticking = false; // single-flight guard

async function tick(): Promise<void> {
	if (ticking) return;
	ticking = true;
	try {
		// Sweep expired deal_queue rows before picking new work — keeps
		// dashboards from showing past-TTL rows even on idle ticks where
		// no watchlist is due. One UPDATE, no row scan.
		try {
			const expired = await expireStaleDealQueueRows();
			if (expired > 0) console.log(`[watchlists] expired ${expired} stale deal_queue row(s)`);
		} catch (err) {
			console.error("[watchlists] expire sweep failed:", err);
		}
		const due = await pickDueWatchlists(5);
		if (due.length === 0) return;
		console.log(`[watchlists] running ${due.length} watchlist scan(s)`);
		for (const w of due) {
			const r = await runWatchlistScan(w);
			console.log(
				`[watchlists] watchlist ${w.id} (${w.name}) — scanned=${r.scanned} queued=${r.queued}` +
					(r.error ? ` error=${r.error}` : ""),
			);
		}
	} catch (err) {
		console.error("[watchlists] tick failed:", err);
	} finally {
		ticking = false;
	}
}

async function digestTick(): Promise<void> {
	try {
		const sent = await sendDigestEmails();
		if (sent > 0) console.log(`[watchlists] digest delivered to ${sent} owner(s)`);
	} catch (err) {
		console.error("[watchlists] digest failed:", err);
	}
}

export function startWatchlistScheduler(): void {
	if (!config.WATCHLIST_SCHEDULER_ENABLED) {
		console.log("[watchlists] scheduler disabled (set WATCHLIST_SCHEDULER_ENABLED=1 to enable)");
		return;
	}
	if (tickHandle) return;
	console.log(
		`[watchlists] scheduler starting; tick=${TICK_INTERVAL_MS / 1000}s, digest=${DIGEST_INTERVAL_MS / 60000}m`,
	);
	// Run a tick immediately on boot so freshly-deployed servers don't
	// wait the full interval before processing backlog.
	void tick();
	tickHandle = setInterval(() => void tick(), TICK_INTERVAL_MS);
	digestHandle = setInterval(() => void digestTick(), DIGEST_INTERVAL_MS);
}

export function stopWatchlistScheduler(): void {
	if (tickHandle) {
		clearInterval(tickHandle);
		tickHandle = null;
	}
	if (digestHandle) {
		clearInterval(digestHandle);
		digestHandle = null;
	}
}
