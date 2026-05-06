/**
 * buy/offer — auction proxy bidding.
 *
 * Three transports, mirroring `/v1/purchases`:
 *
 *   REST — eBay's Buy Offer (Bidding) API (Limited Release).
 *     POST `/buy/offer/v1_beta/bidding/{itemId}/place_proxy_bid`
 *     GET  `/buy/offer/v1_beta/bidding/{itemId}` — current bid status
 *     Gated by `EBAY_BIDDING_APPROVED=1` after eBay approves the program.
 *
 *   Bridge — paired Chrome extension drives the Place-Bid click on
 *     ebay.com inside the buyer's real session. Task name
 *     `ebay_place_bid`; metadata carries `listingId` + `maxAmount` so
 *     the extension's recipe runtime can dispatch by URL pattern.
 *
 *   URL — no extension required. The API returns `nextAction.url`
 *     pointing at the ebay.com/itm page; the user clicks Place Bid
 *     on eBay's own UI. Reconciler matches via `BidList` diff against
 *     a snapshot captured at queue time (same path as bridge).
 *
 * Auto-pick order: REST → BRIDGE (if paired) → URL.
 *
 * There is no REST endpoint that returns "all my bids" — Trading
 * `GetMyeBayBuying.BidList` is the only path. The list view here
 * therefore routes through Trading and reuses the row→Item shape from
 * `services/me-overview.ts`. The previous wrapper called
 * `/buy/offer/v1/bidding` (no `_beta`, no item-id), which returned a
 * silent 404 swallowed by the now-removed `.catch(() => null)`.
 * Verified live 2026-05-02: `/buy/offer/v1_beta/bidding/{id}/place_proxy_bid`
 * returns errorId 2004 ACCESS on a fake itemId — endpoint exists, this
 * is the right path.
 */

import type { Bid, BidCreate, BidStatus } from "@flipagent/types";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { bridgeJobs, type BridgeJob as DbBridgeJob } from "../db/schema.js";
import { cancelJob, createBridgeJob, getJobForApiKey, waitForTerminal } from "./bridge-jobs.js";
import { captureMyEbaySnapshot, reconcileJob } from "./bridge-reconciler.js";
import { BRIDGE_TASKS } from "./ebay/bridge/tasks.js";
import { getUserAccessToken } from "./ebay/oauth.js";
import { sellRequest, swallowEbay404 } from "./ebay/rest/user-client.js";
import { getMyEbayBuying } from "./ebay/trading/myebay.js";
import { toCents, toDollarString } from "./shared/money.js";
import { type NextAction, type NextActionKind, openUrlAction } from "./shared/next-action.js";
import { selectTransport, TransportUnavailableError } from "./shared/transport.js";

/**
 * Short fast-path wait — POST /v1/bids blocks for this many ms before
 * returning a `pending` Bid for the agent to poll. The reconciler in
 * `bridge-reconciler.ts` is the actual completion oracle; we only wait
 * here so a happy-path bid that completes within seconds doesn't
 * round-trip through a separate poll. 5 s is enough for the lucky
 * case where the user is already on the page and clicks immediately
 * (notification → focus → click → eBay confirm modal).
 *
 * Longer waits make the API a long-poll, which fights reverse-proxy
 * idle timeouts and ties up an HTTP socket per bid. Polling via
 * `GET /v1/bids/{listingId}` (which runs the reconciler inline) is
 * cheap and matches the `/v1/purchases` async pattern.
 */
const PLACE_BID_FAST_WAIT_MS = 5_000;

/**
 * Wait for a bridge `bids.status` read (a transient query, not a
 * placement). The extension responds inline, so this stays short.
 */
const STATUS_BRIDGE_WAIT_MS = 25_000;

/**
 * Thrown by `placeBid` / `getBidStatus` when the Buy Offer (Bidding)
 * surface is unavailable, or upstream eBay/extension failure.
 */
export class BidError extends Error {
	readonly status: number;
	readonly code: string;
	readonly nextActionKind: NextActionKind | undefined;
	constructor(code: string, status: number, message: string, nextActionKind?: NextActionKind) {
		super(message);
		this.name = "BidError";
		this.code = code;
		this.status = status;
		this.nextActionKind = nextActionKind;
	}
}

export interface BidsContext {
	apiKeyId: string;
	userId: string | null;
	bridgePaired?: boolean;
}

function pickTransport(
	resource: "bids.place" | "bids.status",
	input: { transport?: "rest" | "bridge" | "url" },
	ctx: BidsContext,
): "rest" | "bridge" | "url" {
	try {
		const picked = selectTransport(resource, {
			explicit: input.transport,
			oauthBound: true,
			bridgePaired: ctx.bridgePaired ?? false,
			envFlags: { EBAY_BIDDING_APPROVED: config.EBAY_BIDDING_APPROVED },
		});
		// `bids.place` / `bids.status` declare rest+bridge+url in the
		// capability matrix, so the broader `Transport` union narrows
		// to these three at runtime — the cast is sound.
		return picked as "rest" | "bridge" | "url";
	} catch (err) {
		if (err instanceof TransportUnavailableError) {
			// `url` is unconditional in the capability matrix, so this
			// branch is unreachable today — kept so future capability
			// changes surface clearly.
			throw new BidError("bidding_unavailable", 412, err.message, "configure_bidding_api");
		}
		throw err;
	}
}

function bidDeeplinkAction(itemId: string): NextAction {
	return openUrlAction(
		`https://www.ebay.com/itm/${encodeURIComponent(itemId)}`,
		'Direct the user to this URL to place the bid. They click "Place bid" on eBay\'s own UI and confirm. flipagent reconciles completion against the buyer\'s BidList — call GET /v1/bids/{listingId} a few seconds after the user clicks through to see status flip from "pending" to "active" or "outbid".',
	);
}

// eBay's `auctionStatus` enum values per OAS3 spec
// (`references/ebay-mcp/docs/_mirror/buy_offer_v1_beta_oas3.json`)
// AuctionStatusEnum: LIVE | ENDED. flipagent's `BidStatus` is more
// granular (active/won/lost/outbid/cancelled) — we derive won/lost
// from `highBidder` when ENDED in `ebayBidToFlipagent`.

/**
 * eBay's `Bidding` response shape (verified against the OAS3 spec
 * 2026-05-03 via field-diff). Earlier versions of this wrapper invented
 * field names like `biddingId`, `bidAmount`, `bidderUsername`,
 * `currentBidStatus` — none of which are in the spec. Every field below
 * is verbatim from `components.schemas.Bidding`.
 */
interface EbayBidding {
	auctionEndDate?: string;
	auctionStatus?: string;
	bidCount?: number;
	currentPrice?: { value: string; currency: string };
	currentProxyBid?: { maxAmount?: { value: string; currency: string }; proxyBidId?: string };
	highBidder?: boolean;
	itemId?: string;
	reservePriceMet?: boolean;
}

function ebayBidToFlipagent(b: EbayBidding, fallbackItemId?: string): Bid {
	const ended = b.auctionStatus === "ENDED";
	const status: BidStatus = ended ? (b.highBidder ? "won" : "lost") : "active";
	return {
		id: b.currentProxyBid?.proxyBidId ?? "",
		marketplace: "ebay_us",
		listingId: b.itemId ?? fallbackItemId ?? "",
		amount: b.currentPrice
			? { value: toCents(b.currentPrice.value), currency: b.currentPrice.currency }
			: { value: 0, currency: "USD" },
		...(b.currentProxyBid?.maxAmount
			? {
					maxBid: {
						value: toCents(b.currentProxyBid.maxAmount.value),
						currency: b.currentProxyBid.maxAmount.currency,
					},
				}
			: {}),
		status,
		// eBay never exposes the bidder's username — only `highBidder: bool`.
		// `placedAt` not in spec either; left blank rather than fabricated.
		placedAt: "",
		...(b.auctionEndDate ? { auctionEndsAt: b.auctionEndDate } : {}),
	};
}

/**
 * Bridge-side bid result. The extension reports `{ proxyBidId,
 * currentPriceCents, maxAmountCents, currency, auctionEndDate }`
 * after clicking Place Bid + reading the confirmation panel.
 * Optional fields stay optional because eBay's confirmation page
 * occasionally omits them (e.g. when the user is already high bidder).
 */
interface BridgeBidResult {
	proxyBidId?: string;
	currentPriceCents?: number;
	maxAmountCents?: number;
	currency?: string;
	auctionStatus?: "LIVE" | "ENDED";
	auctionEndDate?: string;
	highBidder?: boolean;
}

function bridgeResultToFlipagent(input: BidCreate, result: BridgeBidResult): Bid {
	const currency = result.currency ?? input.amount.currency;
	const amount = result.currentPriceCents != null ? { value: result.currentPriceCents, currency } : input.amount;
	const maxBid =
		result.maxAmountCents != null
			? { value: result.maxAmountCents, currency }
			: input.maxBid
				? input.maxBid
				: undefined;
	const ended = result.auctionStatus === "ENDED";
	const status: BidStatus = ended ? (result.highBidder ? "won" : "lost") : "active";
	return {
		id: result.proxyBidId ?? "",
		marketplace: "ebay_us",
		listingId: input.listingId,
		amount,
		...(maxBid ? { maxBid } : {}),
		status,
		placedAt: new Date().toISOString(),
		...(result.auctionEndDate ? { auctionEndsAt: result.auctionEndDate } : {}),
	};
}

export async function listBids(ctx: BidsContext): Promise<{ bids: Bid[] }> {
	const token = await getUserAccessToken(ctx.apiKeyId);
	const buying = await getMyEbayBuying(token);
	const bids: Bid[] = buying.bidding.items.map((row) => {
		// `amount` is the current high price for this listing (what the bid
		// is sitting at right now) — `MaxBid` is the user's proxy ceiling.
		// The earlier mapping fell back to 0 because it never read either;
		// trading docs put the live price on `SellingStatus.CurrentPrice`,
		// which our `rowsFrom` now exposes as `priceValue`. The proxy
		// ceiling lands on the dedicated `maxBid` field below.
		const currency = row.priceCurrency ?? row.maxBidCurrency ?? "USD";
		const amount = row.priceValue
			? { value: toCents(row.priceValue), currency }
			: row.maxBidValue
				? { value: toCents(row.maxBidValue), currency }
				: { value: 0, currency };
		const maxBid = row.maxBidValue
			? { value: toCents(row.maxBidValue), currency: row.maxBidCurrency ?? currency }
			: undefined;
		// BidList only contains live auctions (won/lost move to WonList /
		// LostList). `highBidder=false` is the only case that maps off
		// `active` — surface it as `outbid` so the agent knows to raise.
		const status: BidStatus = row.highBidder === false ? "outbid" : "active";
		return {
			id: row.itemId,
			marketplace: "ebay_us",
			listingId: row.itemId,
			amount,
			...(maxBid ? { maxBid } : {}),
			status,
			placedAt: row.startDate ?? "",
			...(row.endDate ? { auctionEndsAt: row.endDate } : {}),
		};
	});
	return { bids };
}

/** Find the most recent in-flight bridge place-bid job for this
 * listing, scoped to the calling api key. Used by `getBidStatus` to
 * opportunistically reconcile pending bids on read. */
async function findInflightPlaceBidJob(itemId: string, apiKeyId: string): Promise<DbBridgeJob | null> {
	const rows = await db
		.select()
		.from(bridgeJobs)
		.where(
			and(
				eq(bridgeJobs.apiKeyId, apiKeyId),
				eq(bridgeJobs.itemId, itemId),
				eq(bridgeJobs.source, "ebay"),
				inArray(bridgeJobs.status, ["queued", "claimed", "placing", "awaiting_user_confirm"]),
				sql`${bridgeJobs.metadata}->>'task' = ${BRIDGE_TASKS.EBAY_PLACE_BID}`,
				sql`${bridgeJobs.metadata}->>'op' = 'place'`,
			),
		)
		.orderBy(desc(bridgeJobs.createdAt))
		.limit(1);
	return rows[0] ?? null;
}

/** Map a bridge job row → Bid for the polling agent. Picks the right
 * status based on the row's terminal state + result payload. Pending
 * rows whose origin transport was "url" carry `nextAction.url` so the
 * agent can re-prompt the user to click through if they walked away. */
function jobToBid(job: DbBridgeJob, listingId: string): Bid {
	const meta = (job.metadata ?? {}) as {
		maxAmountCents?: number;
		currency?: string;
		transport?: "bridge" | "url";
	};
	const result = (job.result ?? {}) as BridgeBidResult;
	const currency = result.currency ?? meta.currency ?? "USD";
	const requestedMax = meta.maxAmountCents ?? job.maxPriceCents ?? 0;
	const baseMaxBid = requestedMax > 0 ? { value: requestedMax, currency } : undefined;
	if (job.status === "completed") {
		// Reconciler or content script confirmed — surface the captured
		// after-state (current price, proxy ceiling, who's winning).
		return bridgeResultToFlipagent(
			{
				listingId,
				amount: { value: result.currentPriceCents ?? requestedMax, currency },
				...(baseMaxBid ? { maxBid: baseMaxBid } : {}),
			},
			result,
		);
	}
	const status: BidStatus =
		job.status === "failed" || job.status === "cancelled" || job.status === "expired" ? "cancelled" : "pending";
	return {
		id: job.id,
		marketplace: "ebay_us",
		listingId,
		amount: { value: result.currentPriceCents ?? requestedMax, currency },
		...(baseMaxBid ? { maxBid: baseMaxBid } : {}),
		status,
		placedAt: job.createdAt.toISOString(),
		...(status === "pending" && meta.transport === "url" ? { nextAction: bidDeeplinkAction(listingId) } : {}),
	};
}

/**
 * Cancel a bridge-transport bid that's still in flight in the user's
 * browser (queued / claimed / placing / awaiting_user_confirm).
 *
 * Important: this CANNOT retract a bid that already landed on eBay's
 * side — eBay's rules permit bid retraction only in narrow cases
 * (typo, item description changed materially, end of auction unable
 * to contact seller) and that's a manual eBay UI flow. What this
 * does cancel is the bridge-job → tells the Chrome extension "stop
 * waiting for the user's click on this listing". If the user has
 * already clicked Place Bid in their tab, the bid is on eBay and
 * this is a no-op.
 *
 * Returns the latest in-flight bid job mapped to a Bid (now with
 * `status: "cancelled"`), or null if nothing was in flight to cancel.
 */
export async function cancelBid(itemId: string, ctx: BidsContext): Promise<Bid | null> {
	const inflight = await findInflightPlaceBidJob(itemId, ctx.apiKeyId);
	if (!inflight) return null;
	const cancelled = await cancelJob(inflight.id, ctx.apiKeyId);
	const row = cancelled ?? (await getJobForApiKey(inflight.id, ctx.apiKeyId));
	return row ? jobToBid(row, itemId) : null;
}

export async function getBidStatus(itemId: string, ctx: BidsContext): Promise<Bid | null> {
	// Lazy reconciler: if a bridge place-bid job is in flight for this
	// listing, run one Trading API check against `bidList` first. This
	// converts polling agents into the reconciliation engine — no
	// dependency on the worker's tick — and lets a happy-path bid flip
	// from `pending` → `active` on the very next GET after the user
	// clicks Place Bid.
	const inflight = await findInflightPlaceBidJob(itemId, ctx.apiKeyId);
	if (inflight) {
		await reconcileJob(inflight.id, ctx.apiKeyId).catch((err) =>
			console.warn("[getBidStatus] inline reconcile failed:", err),
		);
		const refreshed = await getJobForApiKey(inflight.id, ctx.apiKeyId);
		if (refreshed) return jobToBid(refreshed, itemId);
	}

	const transport = pickTransport("bids.status", {}, ctx);
	if (transport === "rest") {
		const res = await sellRequest<EbayBidding>({
			apiKeyId: ctx.apiKeyId,
			method: "GET",
			path: `/buy/offer/v1_beta/bidding/${encodeURIComponent(itemId)}`,
		}).catch(swallowEbay404);
		return res ? ebayBidToFlipagent(res, itemId) : null;
	}
	if (transport === "bridge") {
		// Bridge — ask the extension to read the current Place-Bid panel.
		const job = await createBridgeJob({
			apiKeyId: ctx.apiKeyId,
			userId: ctx.userId,
			source: "ebay",
			itemId,
			quantity: 1,
			maxPriceCents: null,
			idempotencyKey: null,
			metadata: { task: BRIDGE_TASKS.EBAY_PLACE_BID, op: "status", listingId: itemId },
		});
		const final = await waitForTerminal(job.id, ctx.apiKeyId, STATUS_BRIDGE_WAIT_MS);
		if (!final) {
			throw new BidError("bridge_timeout", 504, "Bridge client did not respond.", "extension_install");
		}
		if (final.status === "failed" || final.status === "cancelled" || final.status === "expired") {
			// `failed` with a "no bids on this item" reason → null
			// (matches REST 404 semantics). Anything else surfaces as 502.
			const reason = final.failureReason ?? "";
			if (reason.toLowerCase().includes("no_bid") || reason.toLowerCase().includes("not_found")) return null;
			throw new BidError("bridge_failed", 502, reason || `Bridge bid status read ${final.status}.`);
		}
		if (final.status !== "completed") {
			throw new BidError(
				"bridge_pending",
				504,
				`Bid status read still in progress (status: ${final.status}). Retry shortly.`,
			);
		}
		const result = (final.result ?? {}) as BridgeBidResult;
		if (!result.proxyBidId && result.currentPriceCents == null) return null;
		return bridgeResultToFlipagent(
			{ listingId: itemId, amount: { value: 0, currency: result.currency ?? "USD" } },
			result,
		);
	}
	// url — read the live BidList via Trading and find the matching
	// listing. No tracking row needed; this is a pure status read.
	const token = await getUserAccessToken(ctx.apiKeyId);
	const buying = await getMyEbayBuying(token);
	const row = buying.bidding.items.find((r) => r.itemId === itemId);
	if (!row) return null;
	const currency = row.priceCurrency ?? row.maxBidCurrency ?? "USD";
	const amount = row.priceValue
		? { value: toCents(row.priceValue), currency }
		: row.maxBidValue
			? { value: toCents(row.maxBidValue), currency }
			: { value: 0, currency };
	const maxBid = row.maxBidValue
		? { value: toCents(row.maxBidValue), currency: row.maxBidCurrency ?? currency }
		: undefined;
	const status: BidStatus = row.highBidder === false ? "outbid" : "active";
	return {
		id: row.itemId,
		marketplace: "ebay_us",
		listingId: row.itemId,
		amount,
		...(maxBid ? { maxBid } : {}),
		status,
		placedAt: row.startDate ?? "",
		...(row.endDate ? { auctionEndsAt: row.endDate } : {}),
	};
}

export async function placeBid(input: BidCreate, ctx: BidsContext): Promise<Bid> {
	const transport = pickTransport("bids.place", input, ctx);

	if (transport === "rest") {
		// `PlaceProxyBidResponse` per spec returns `{ proxyBidId }` only —
		// NOT `biddingId` (verified 2026-05-03). The bid is recorded once
		// the response comes back; current price + proxy bid amount come
		// from a follow-up GET /bidding/{itemId} call.
		const res = await sellRequest<{ proxyBidId?: string }>({
			apiKeyId: ctx.apiKeyId,
			method: "POST",
			path: `/buy/offer/v1_beta/bidding/${encodeURIComponent(input.listingId)}/place_proxy_bid`,
			body: {
				maxAmount: input.maxBid
					? { value: toDollarString(input.maxBid.value), currency: input.maxBid.currency }
					: { value: toDollarString(input.amount.value), currency: input.amount.currency },
				userConsent: { adultItems: false },
			},
		});
		return {
			id: res?.proxyBidId ?? "",
			marketplace: "ebay_us",
			listingId: input.listingId,
			amount: input.amount,
			...(input.maxBid ? { maxBid: input.maxBid } : {}),
			status: "active",
			placedAt: new Date().toISOString(),
		};
	}

	// Bridge + url transports both queue a tracking row backed by the
	// reconciler in `bridge-reconciler.ts` (the completion oracle: it
	// diffs the user's `bidList` against a snapshot captured here at
	// job creation, transitioning the job once eBay confirms the bid
	// landed). Differences:
	//   - bridge waits a SHORT fast-path window (5 s) for the paired
	//     extension to drive the click + report inline — happy paths
	//     close without making the agent poll
	//   - url skips the fast-path wait (no extension to claim the row)
	//     and returns a `pending` Bid + `nextAction.url` immediately so
	//     the agent can prompt the user to click on ebay.com themselves
	// Either way the agent polls `GET /v1/bids/{listingId}` (which
	// runs the reconciler inline) until terminal; the worker also
	// reconciles on a 30s tick. Rows that drag on for minutes (user
	// paged into 2FA, IRL distraction) just stay `pending` until the
	// reconciler matches or `expires_at` (30 min) sweeps them.
	const cap = input.maxBid ?? input.amount;
	const beforeSnapshot = await captureMyEbaySnapshot(ctx.apiKeyId).catch((err) => {
		console.warn("[placeBid] beforeSnapshot capture failed:", err);
		return undefined;
	});
	const job = await createBridgeJob({
		apiKeyId: ctx.apiKeyId,
		userId: ctx.userId,
		source: "ebay",
		itemId: input.listingId,
		quantity: 1,
		maxPriceCents: cap.value,
		idempotencyKey: null,
		metadata: {
			task: BRIDGE_TASKS.EBAY_PLACE_BID,
			op: "place",
			transport,
			listingId: input.listingId,
			maxAmountCents: cap.value,
			currency: cap.currency,
			...(beforeSnapshot ? { beforeSnapshot } : {}),
		},
	});

	if (transport === "bridge") {
		const fast = await waitForTerminal(job.id, ctx.apiKeyId, PLACE_BID_FAST_WAIT_MS);
		if (fast?.status === "completed") {
			return bridgeResultToFlipagent(input, (fast.result ?? {}) as BridgeBidResult);
		}
		if (fast?.status === "failed" || fast?.status === "cancelled" || fast?.status === "expired") {
			throw new BidError("bridge_failed", 502, fast.failureReason || `Bridge bid placement ${fast.status}.`);
		}
		// Still in flight after the fast window — fall through to the
		// pending Bid below (no nextAction; extension is on it).
		return {
			id: job.id,
			marketplace: "ebay_us",
			listingId: input.listingId,
			amount: input.amount,
			...(input.maxBid ? { maxBid: input.maxBid } : {}),
			status: "pending",
			placedAt: job.createdAt.toISOString(),
		};
	}

	// url transport — return immediately with the deeplink so the
	// agent can prompt the user to click Place Bid on ebay.com.
	return {
		id: job.id,
		marketplace: "ebay_us",
		listingId: input.listingId,
		amount: input.amount,
		...(input.maxBid ? { maxBid: input.maxBid } : {}),
		status: "pending",
		placedAt: job.createdAt.toISOString(),
		nextAction: bidDeeplinkAction(input.listingId),
	};
}
