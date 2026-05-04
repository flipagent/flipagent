/**
 * buy/offer — auction proxy bidding.
 *
 * Two transports, mirroring `/v1/purchases`:
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
 *     Used as the universal fallback when REST isn't approved (or as
 *     an explicit `?transport=bridge` override).
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
import { config } from "../config.js";
import { createBridgeJob, waitForTerminal } from "./bridge-jobs.js";
import { BRIDGE_TASKS } from "./ebay/bridge/tasks.js";
import { getUserAccessToken } from "./ebay/oauth.js";
import { sellRequest, swallowEbay404 } from "./ebay/rest/user-client.js";
import { getMyEbayBuying } from "./ebay/trading/myebay.js";
import { toCents, toDollarString } from "./shared/money.js";
import type { NextActionKind } from "./shared/next-action.js";
import { selectTransport, TransportUnavailableError } from "./shared/transport.js";

/**
 * Maximum age of a `humanReviewedAt` attestation accepted by `placeBid`.
 * Mirrors the value in `services/purchases/orchestrate.ts` so the
 * agent-side UX (confirm-then-submit) is consistent across buy + bid.
 */
const HUMAN_REVIEW_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * How long the route blocks waiting for the Chrome extension to claim
 * + execute a bid job before giving up. Matches the browser-primitive
 * window in `routes/v1/browser.ts`.
 */
const BRIDGE_WAIT_MS = 25_000;

/**
 * Thrown by `placeBid` / `getBidStatus` when the Buy Offer (Bidding)
 * surface is unavailable — REST not approved AND no bridge paired,
 * stale human-review attestation, or upstream eBay/extension failure.
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
	input: { transport?: "rest" | "bridge" },
	ctx: BidsContext,
): "rest" | "bridge" {
	try {
		const picked = selectTransport(resource, {
			explicit: input.transport,
			oauthBound: true,
			bridgePaired: ctx.bridgePaired ?? true,
			envFlags: { EBAY_BIDDING_APPROVED: config.EBAY_BIDDING_APPROVED },
		});
		// `bids.place` / `bids.status` only declare rest+bridge in the
		// capability matrix, so the broader `Transport` union narrows to
		// these two at runtime — the cast is sound.
		return picked as "rest" | "bridge";
	} catch (err) {
		if (err instanceof TransportUnavailableError) {
			throw new BidError(
				"bidding_unavailable",
				412,
				"No available transport for auction bidding. Apply at developer.ebay.com → Buy APIs → Buy Offer and set EBAY_BIDDING_APPROVED=1 for REST, or pair the Chrome extension for bridge.",
				"configure_bidding_api",
			);
		}
		throw err;
	}
}

function ensureFreshHumanReview(input: { humanReviewedAt?: string }): void {
	const ts = input.humanReviewedAt ? Date.parse(input.humanReviewedAt) : NaN;
	if (!Number.isFinite(ts)) {
		throw new BidError(
			"human_review_required",
			412,
			"`/v1/bids` requires a fresh `humanReviewedAt` ISO timestamp on every call. eBay's User Agreement (effective Feb 20, 2026) prohibits placing bids without human review; this field is your attestation that a human in your interface confirmed THIS specific bid. Apply for eBay Buy Offer (Bidding) API approval to satisfy the requirement at the developer-account level instead.",
		);
	}
	const age = Date.now() - ts;
	if (age < 0 || age > HUMAN_REVIEW_MAX_AGE_MS) {
		throw new BidError(
			"human_review_stale",
			412,
			`\`humanReviewedAt\` must be within the last ${HUMAN_REVIEW_MAX_AGE_MS / 1000} seconds. Re-confirm the bid in your UI and resubmit.`,
		);
	}
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
		marketplace: "ebay",
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
		marketplace: "ebay",
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
	const bids: Bid[] = buying.bidding.items.map((row) => ({
		id: row.itemId,
		marketplace: "ebay",
		listingId: row.itemId,
		amount: row.priceValue
			? { value: toCents(row.priceValue), currency: row.priceCurrency ?? "USD" }
			: { value: 0, currency: "USD" },
		status: "active",
		placedAt: row.startDate ?? "",
		...(row.endDate ? { auctionEndsAt: row.endDate } : {}),
	}));
	return { bids };
}

export async function getBidStatus(itemId: string, ctx: BidsContext): Promise<Bid | null> {
	const transport = pickTransport("bids.status", {}, ctx);
	if (transport === "rest") {
		const res = await sellRequest<EbayBidding>({
			apiKeyId: ctx.apiKeyId,
			method: "GET",
			path: `/buy/offer/v1_beta/bidding/${encodeURIComponent(itemId)}`,
		}).catch(swallowEbay404);
		return res ? ebayBidToFlipagent(res, itemId) : null;
	}
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
	const final = await waitForTerminal(job.id, ctx.apiKeyId, BRIDGE_WAIT_MS);
	if (!final) {
		throw new BidError("bridge_timeout", 504, "Bridge client did not respond.", "extension_install");
	}
	if (final.status !== "completed") {
		// `failed` with a "no bids on this item" reason → null (matches
		// REST 404 semantics). Anything else surfaces as 502.
		const reason = final.failureReason ?? "";
		if (reason.toLowerCase().includes("no_bid") || reason.toLowerCase().includes("not_found")) return null;
		throw new BidError("bridge_failed", 502, reason || "Bridge bid status read failed.");
	}
	const result = (final.result ?? {}) as BridgeBidResult;
	if (!result.proxyBidId && result.currentPriceCents == null) return null;
	return bridgeResultToFlipagent(
		{ listingId: itemId, amount: { value: 0, currency: result.currency ?? "USD" } },
		result,
	);
}

export async function placeBid(input: BidCreate, ctx: BidsContext): Promise<Bid> {
	const transport = pickTransport("bids.place", input, ctx);

	// Buy-bot ban (eBay UA Feb-2026): bridge transport requires per-bid
	// human-review attestation; REST requires it unless the developer
	// account holds Buy Offer approval (in which case the attestation is
	// satisfied at the eBay-relationship level, not per call).
	const humanReviewRequired = transport === "bridge" || !config.EBAY_BIDDING_APPROVED;
	if (humanReviewRequired) ensureFreshHumanReview(input);

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
			marketplace: "ebay",
			listingId: input.listingId,
			amount: input.amount,
			...(input.maxBid ? { maxBid: input.maxBid } : {}),
			status: "active",
			placedAt: new Date().toISOString(),
		};
	}

	// Bridge transport — queue the click + wait for the extension to report.
	const cap = input.maxBid ?? input.amount;
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
			listingId: input.listingId,
			maxAmountCents: cap.value,
			currency: cap.currency,
		},
	});
	const final = await waitForTerminal(job.id, ctx.apiKeyId, BRIDGE_WAIT_MS);
	if (!final) {
		throw new BidError("bridge_timeout", 504, "Bridge client did not respond.", "extension_install");
	}
	if (final.status !== "completed") {
		throw new BidError("bridge_failed", 502, final.failureReason || "Bridge bid placement failed.");
	}
	return bridgeResultToFlipagent(input, (final.result ?? {}) as BridgeBidResult);
}
