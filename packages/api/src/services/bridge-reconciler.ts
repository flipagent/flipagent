/**
 * Bridge-job reconciler — closes the loop on bridge-transport actions
 * (bid, buy) by treating eBay's `GetMyeBayBuying` response as the
 * authoritative oracle.
 *
 * Both `/v1/bids` and `/v1/purchases` go through the same bridge:
 * we open a tab, the user clicks, the content script reports back via
 * `/v1/bridge/result`. DOM scraping for confirmation is fragile (eBay
 * rotates layouts; the confirmation panel renders inline, in a modal,
 * or on a separate URL depending on the day). The reconciler
 * sidesteps that by polling the user's actual MyeBay state and
 * comparing against a snapshot we captured before queuing the job:
 *
 *   captureMyEbaySnapshot()  → `bridge_jobs.metadata.beforeSnapshot`
 *   ↓ user clicks Place Bid / Confirm and pay in the tab
 *   reconcileJob() polls MyeBay, diffs against snapshot
 *   ↓ matching itemId now winning / appears in WonList
 *   transition(completed, result={...})
 *
 * The DOM observer in the extension is kept as the fast-path UX layer
 * — when it succeeds it's milliseconds faster than the reconciler.
 * When it fails (false negative), the reconciler is the safety net
 * that keeps the agent's polling honest.
 *
 * Two callers:
 *   - Inline on `GET /v1/bids/{listingId}` / `GET /v1/purchases/{id}`
 *     → single Trading call (~300-700 ms), so a polling agent gets
 *     terminal state on the next call without waiting for the worker.
 *   - Worker `reconcileLoop` → `reconcileAllInFlight()` every 30 s for
 *     jobs nobody is actively polling.
 *
 * Adapter pattern: each resource (bid, purchase) plugs in a
 * `ReconcilerAdapter` that knows how to (a) recognise its own jobs in
 * the bridge_jobs table and (b) match a snapshot diff to a completion
 * payload. Adding a new bridge-driven resource = add an adapter
 * below + register it in `ALL_ADAPTERS`. No changes to the dispatch
 * loop.
 */

import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { bridgeJobs, type BridgeJob as DbBridgeJob } from "../db/schema.js";
import { transition } from "./bridge-jobs.js";
import { BRIDGE_TASKS } from "./ebay/bridge/tasks.js";
import { getUserAccessToken } from "./ebay/oauth.js";
import { getMyEbayBuying, type MyEbayItemRow } from "./ebay/trading/myebay.js";
import { toCents } from "./shared/money.js";

/* ------------------------------ snapshot ------------------------------ */

/** A single bid row in the snapshot. `null` fields mean Trading
 * didn't return that subfield (varies by listing type). */
export interface BiddingEntry {
	itemId: string;
	maxBidCents: number | null;
	currentPriceCents: number | null;
	bidCount: number | null;
	highBidder: boolean | null;
}

/** A single won row in the snapshot. `orderLineItemId` is the unique
 * key for THIS purchase — multiple wins of the same itemId get
 * separate ids. */
export interface WonEntry {
	itemId: string;
	orderLineItemId: string | null;
	currentPriceCents: number | null;
	currency: string;
}

export interface MyEbaySnapshot {
	/** itemId → bid info (only for items the caller has bid on). */
	bidding: Record<string, BiddingEntry>;
	/** itemId → list of won entries (multiple if user purchased the
	 * same itemId more than once). */
	won: Record<string, WonEntry[]>;
}

/** Single Trading call, parsed into the slices each adapter cares
 * about. Shared across adapters in one tick — calling once per
 * apiKey covers every reconcilable bridge job for that user. */
export async function captureMyEbaySnapshot(apiKeyId: string): Promise<MyEbaySnapshot> {
	const token = await getUserAccessToken(apiKeyId);
	const buying = await getMyEbayBuying(token);
	return {
		bidding: indexBidding(buying.bidding.items),
		won: indexWon(buying.won.items),
	};
}

function indexBidding(rows: MyEbayItemRow[]): Record<string, BiddingEntry> {
	const out: Record<string, BiddingEntry> = {};
	for (const row of rows) {
		if (!row.itemId) continue;
		out[row.itemId] = {
			itemId: row.itemId,
			maxBidCents: row.maxBidValue ? toCents(row.maxBidValue) : null,
			currentPriceCents: row.priceValue ? toCents(row.priceValue) : null,
			bidCount: row.bidCount,
			highBidder: row.highBidder,
		};
	}
	return out;
}

function indexWon(rows: MyEbayItemRow[]): Record<string, WonEntry[]> {
	const out: Record<string, WonEntry[]> = {};
	for (const row of rows) {
		if (!row.itemId) continue;
		const entry: WonEntry = {
			itemId: row.itemId,
			orderLineItemId: row.orderLineItemId,
			currentPriceCents: row.priceValue ? toCents(row.priceValue) : null,
			currency: row.priceCurrency ?? "USD",
		};
		const existing = out[row.itemId];
		if (existing) {
			existing.push(entry);
		} else {
			out[row.itemId] = [entry];
		}
	}
	return out;
}

/* ------------------------------ adapters ------------------------------ */

/** Result of a successful diff: what to write into the bridge job
 * row when transitioning to `completed`. All optional except `result`. */
export interface MatchedOutcome {
	result: Record<string, unknown>;
	ebayOrderId?: string;
	totalCents?: number;
	receiptUrl?: string;
}

/** Plug-in for a bridge-job kind. The reconciler dispatch loop calls
 * `matches` to route a job, then `matchOutcome` to test if eBay's
 * state has caught up. */
export interface ReconcilerAdapter {
	name: string;
	matches(job: DbBridgeJob): boolean;
	matchOutcome(snapshot: MyEbaySnapshot, job: DbBridgeJob): MatchedOutcome | null;
}

/* ----- bid adapter ----- */

interface BidJobMeta {
	task?: string;
	op?: string;
	listingId?: string;
	maxAmountCents?: number;
	currency?: string;
	beforeSnapshot?: { bidding?: Record<string, BiddingEntry>; won?: Record<string, WonEntry[]> };
}

const bidAdapter: ReconcilerAdapter = {
	name: "ebay_place_bid",
	matches(job) {
		const meta = (job.metadata ?? {}) as BidJobMeta;
		return job.source === "ebay" && meta.task === BRIDGE_TASKS.EBAY_PLACE_BID && meta.op === "place";
	},
	matchOutcome(snapshot, job) {
		const meta = (job.metadata ?? {}) as BidJobMeta;
		const itemId = meta.listingId ?? job.itemId;
		const requestedMax = meta.maxAmountCents ?? job.maxPriceCents ?? 0;
		const before = meta.beforeSnapshot?.bidding;
		const after = snapshot.bidding[itemId];
		if (!after) return null;
		const beforeRow = before?.[itemId];
		const landed = bidLanded(beforeRow, after, requestedMax);
		if (!landed) return null;
		const currency = meta.currency ?? "USD";
		return {
			result: {
				source: "trading_reconciler",
				currentPriceCents: after.currentPriceCents ?? undefined,
				maxAmountCents: after.maxBidCents ?? requestedMax,
				currency,
				auctionStatus: "LIVE",
				highBidder: after.highBidder ?? undefined,
				bidCount: after.bidCount ?? undefined,
			},
		};
	},
};

/** Was the user's bid actually placed? Two cases:
 *   (a) Net-new entry: BidList didn't have this itemId before, now does.
 *       eBay only adds rows when a bid posts, and only the caller's
 *       own bids show up in their BidList — net-new is unambiguously us.
 *   (b) Existing entry: caller had bid before, and the snapshot now
 *       shows a maxBid matching what we asked for (within ±1¢).
 *       This is intentionally tight — `maxBidGrew` alone or `bidCount
 *       rose` alone are FALSE-POSITIVE risks (a third party bidding
 *       on the same item during our window would trip them, marking
 *       our job completed when the user never clicked Place Bid).
 *       Requiring the `requestedMaxCents` match means: yes, that
 *       specific number we sent appeared on eBay's side. Only the
 *       user clicking through our flow puts that exact value there.
 *
 * Tradeoff: if the user changes the bid amount in eBay's modal (typed
 * something different from what we sent), we won't detect it. The job
 * stays pending until expires_at (30 min) — safer than a wrong match. */
function bidLanded(before: BiddingEntry | undefined, after: BiddingEntry, requestedMaxCents: number): boolean {
	if (!before) return true;
	if (after.maxBidCents == null) return false;
	return Math.abs(after.maxBidCents - requestedMaxCents) <= 1;
}

/* ----- purchase adapter ----- */

interface PurchaseJobMeta {
	task?: string;
	checkoutSessionId?: string;
	beforeSnapshot?: { won?: Record<string, WonEntry[]> };
}

const purchaseAdapter: ReconcilerAdapter = {
	name: "ebay_buy_item",
	matches(job) {
		const meta = (job.metadata ?? {}) as PurchaseJobMeta;
		return job.source === "ebay" && meta.task === BRIDGE_TASKS.EBAY_BUY_ITEM;
	},
	matchOutcome(snapshot, job) {
		const meta = (job.metadata ?? {}) as PurchaseJobMeta;
		const itemId = job.itemId;
		const beforeWon = meta.beforeSnapshot?.won?.[itemId] ?? [];
		const beforeIds = new Set(beforeWon.map((w) => w.orderLineItemId).filter((v): v is string => v != null));
		const afterWon = snapshot.won[itemId] ?? [];
		// New OrderLineItemID for this itemId = our purchase landed.
		const fresh = afterWon.find((w) => w.orderLineItemId && !beforeIds.has(w.orderLineItemId));
		if (!fresh) return null;
		const out: MatchedOutcome = {
			result: {
				source: "trading_reconciler",
				orderLineItemId: fresh.orderLineItemId,
				currentPriceCents: fresh.currentPriceCents ?? undefined,
				currency: fresh.currency,
			},
		};
		if (fresh.orderLineItemId) out.ebayOrderId = fresh.orderLineItemId;
		if (fresh.currentPriceCents != null) out.totalCents = fresh.currentPriceCents;
		return out;
	},
};

/* ----- registry ----- */

export const ALL_ADAPTERS: readonly ReconcilerAdapter[] = [bidAdapter, purchaseAdapter];

/* ------------------------------ dispatch ------------------------------ */

const RECONCILABLE_STATUSES: DbBridgeJob["status"][] = ["queued", "claimed", "placing", "awaiting_user_confirm"];

export interface ReconcileResult {
	jobId: string;
	transitioned: boolean;
	reason?: string;
}

/**
 * Reconcile one job: pick the adapter, fetch the snapshot, run the
 * diff, transition if matched. Idempotent: re-calling on a terminal
 * job is a no-op.
 */
export async function reconcileJob(jobId: string, apiKeyId: string): Promise<ReconcileResult> {
	const [job] = await db.select().from(bridgeJobs).where(eq(bridgeJobs.id, jobId)).limit(1);
	if (!job) return { jobId, transitioned: false, reason: "not_found" };
	if (job.apiKeyId !== apiKeyId) return { jobId, transitioned: false, reason: "wrong_api_key" };
	if (!RECONCILABLE_STATUSES.includes(job.status)) {
		return { jobId, transitioned: false, reason: `terminal:${job.status}` };
	}
	const adapter = ALL_ADAPTERS.find((a) => a.matches(job));
	if (!adapter) return { jobId, transitioned: false, reason: "no_adapter" };

	const snapshot = await captureMyEbaySnapshot(apiKeyId);
	const outcome = adapter.matchOutcome(snapshot, job);
	if (!outcome) return { jobId, transitioned: false, reason: "no_change" };

	await transition({ id: job.id, apiKeyId, to: "completed", ...outcome });
	return { jobId, transitioned: true, reason: `matched:${adapter.name}` };
}

/**
 * Worker entrypoint: scan every reconcilable bridge job, group by api
 * key (one Trading call per user — covers all that user's in-flight
 * bids AND purchases), reconcile each via the matching adapter.
 *
 * Cheap when idle: the WHERE clause hits the indexed `status` column
 * and short-circuits before any Trading call when nothing's queued.
 */
export async function reconcileAllInFlight(): Promise<{ scanned: number; transitioned: number }> {
	const adapterTasks = ALL_ADAPTERS.map((a) => a.name);
	const rows = await db
		.select()
		.from(bridgeJobs)
		.where(
			and(
				eq(bridgeJobs.source, "ebay"),
				inArray(bridgeJobs.status, RECONCILABLE_STATUSES),
				inArray(sql<string>`${bridgeJobs.metadata}->>'task'`, adapterTasks),
				gt(bridgeJobs.expiresAt, new Date()),
			),
		);
	if (rows.length === 0) return { scanned: 0, transitioned: 0 };

	const byKey = new Map<string, DbBridgeJob[]>();
	for (const row of rows) {
		const list = byKey.get(row.apiKeyId) ?? [];
		list.push(row);
		byKey.set(row.apiKeyId, list);
	}

	let transitioned = 0;
	for (const [apiKeyId, jobs] of byKey) {
		const snapshot = await captureMyEbaySnapshot(apiKeyId).catch((err) => {
			console.warn(`[bridge-reconciler] snapshot failed for apiKey ${apiKeyId}:`, err);
			return null;
		});
		if (!snapshot) continue;
		for (const job of jobs) {
			const adapter = ALL_ADAPTERS.find((a) => a.matches(job));
			if (!adapter) continue;
			const outcome = adapter.matchOutcome(snapshot, job);
			if (!outcome) continue;
			await transition({ id: job.id, apiKeyId, to: "completed", ...outcome }).catch((err) =>
				console.warn(`[bridge-reconciler] transition failed for ${job.id}:`, err),
			);
			transitioned++;
		}
	}
	return { scanned: rows.length, transitioned };
}
