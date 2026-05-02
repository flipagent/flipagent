/**
 * `POST /v1/purchases` — initiate + place_order in one shot.
 *
 * The actual eBay-side mechanics (REST passthrough vs bridge queue +
 * BIN-click recipe) live in `services/purchases/bridge-session.ts` already;
 * this module is the thin orchestrator that drives both stages and
 * returns the flipagent `Purchase` shape.
 *
 * Cancel + status-poll + list reuse the existing `getPurchaseOrder` /
 * `cancelJob` paths so a single source of truth for the eBay-shape
 * order is preserved.
 */

import type { Purchase, PurchaseCreate } from "@flipagent/types";
import type { LineItem } from "@flipagent/types/ebay/buy";
import { config } from "../../config.js";
import { cancelJob } from "../bridge-jobs.js";
import type { FlipagentResult, SourceKind } from "../shared/result.js";
import { selectTransport, TransportUnavailableError } from "../shared/transport.js";
import { BridgeCheckoutError, getPurchaseOrder, initiateCheckoutSession, placeOrder } from "./bridge-session.js";
import { ebayToPurchase } from "./transform.js";

export class PurchaseError extends Error {
	readonly status: number;
	readonly code: string;
	constructor(code: string, status: number, message: string) {
		super(message);
		this.name = "PurchaseError";
		this.code = code;
		this.status = status;
	}
}

export interface PurchaseContext {
	apiKeyId: string;
	userId: string | null;
	bridgePaired?: boolean;
}

/**
 * Maximum age of a `humanReviewedAt` attestation accepted by createPurchase.
 * eBay's User Agreement requires "human review" of each order before
 * placement; we operationalise that with a fresh-attestation requirement
 * so a caller can't grandfather an indefinite "I always confirm" flag.
 * Five minutes is enough to cover legitimate confirm-then-submit lag
 * (network, two-factor, slow extension) without admitting unattended
 * pipelines.
 */
const HUMAN_REVIEW_MAX_AGE_MS = 5 * 60 * 1000;

export async function createPurchase(input: PurchaseCreate, ctx: PurchaseContext): Promise<FlipagentResult<Purchase>> {
	const transport = pickTransport(input, ctx);

	// eBay UA Feb-2026 buy-bot ban — bridge transport requires per-order
	// human-review attestation; REST requires it unless the developer
	// account holds Order API approval (in which case the attestation is
	// satisfied at the eBay-relationship level, not per call).
	const humanReviewRequired = transport === "bridge" || !config.EBAY_ORDER_API_APPROVED;
	if (humanReviewRequired) {
		const ts = input.humanReviewedAt ? Date.parse(input.humanReviewedAt) : NaN;
		if (!Number.isFinite(ts)) {
			throw new PurchaseError(
				"human_review_required",
				412,
				"`/v1/purchases` requires a fresh `humanReviewedAt` ISO timestamp on every call. eBay's User Agreement (effective Feb 20, 2026) prohibits placing orders without human review; this field is your attestation that a human in your interface confirmed THIS specific order. Apply for eBay Order API approval to satisfy the requirement at the developer-account level instead.",
			);
		}
		const age = Date.now() - ts;
		if (age < 0 || age > HUMAN_REVIEW_MAX_AGE_MS) {
			throw new PurchaseError(
				"human_review_stale",
				412,
				`\`humanReviewedAt\` must be within the last ${HUMAN_REVIEW_MAX_AGE_MS / 1000} seconds. Re-confirm the order in your UI and resubmit.`,
			);
		}
	}

	if (input.shipTo && transport === "bridge") {
		throw new PurchaseError(
			"shipTo_unsupported_in_bridge_mode",
			412,
			"`shipTo` overrides only work in REST transport — bridge transport uses the buyer's stored eBay default. Set `transport='rest'` (requires EBAY_ORDER_API_APPROVED=1) or remove `shipTo`.",
		);
	}
	if (input.couponCode && transport === "bridge") {
		throw new PurchaseError(
			"coupon_unsupported_in_bridge_mode",
			412,
			"`couponCode` only works in REST transport. Set `transport='rest'` or remove the field.",
		);
	}

	const lineItems: LineItem[] = input.items.map((it) => ({
		itemId: it.itemId,
		quantity: it.quantity ?? 1,
		...(it.variationId ? { variationId: it.variationId } : {}),
	}));

	try {
		// Stage 1 — initiate. Same call for both transports; in REST mode
		// the underlying service forwards to api.ebay.com, in bridge mode
		// it inserts a `buy_checkout_sessions` row.
		const session = await initiateCheckoutSession({
			apiKeyId: ctx.apiKeyId,
			userId: ctx.userId,
			lineItems,
			...(input.shipTo ? { shippingAddresses: [input.shipTo] } : {}),
		});

		// Stage 2 — place_order. Bridge enqueues the BIN task; REST hits
		// eBay synchronously. Either way returns an `EbayPurchaseOrder`.
		const order = await placeOrder(session.checkoutSessionId, ctx.apiKeyId, ctx.userId);
		const body = ebayToPurchase({ order, transport, marketplace: input.marketplace });
		return { body, source: transport, fromCache: false };
	} catch (err) {
		if (err instanceof BridgeCheckoutError) {
			throw new PurchaseError(err.code, err.status, err.message);
		}
		throw err;
	}
}

export async function getPurchase(id: string, apiKeyId: string): Promise<FlipagentResult<Purchase> | null> {
	const order = await getPurchaseOrder(id, apiKeyId);
	if (!order) return null;
	const body = ebayToPurchase({ order });
	// Source = whichever transport originally placed this order; falls
	// back to "rest" when the recorded transport is missing (legacy
	// rows pre-dating the `transport` column).
	const source: SourceKind = body.transport ?? "rest";
	return { body, source, fromCache: false };
}

export async function cancelPurchase(id: string, apiKeyId: string): Promise<FlipagentResult<Purchase> | null> {
	await cancelJob(id, apiKeyId);
	return getPurchase(id, apiKeyId);
}

/**
 * Multi-stage update endpoints — REST transport only. eBay's Buy
 * Order REST exposes shipping_address, payment_instrument, coupon
 * patches mid-checkout. Bridge transport returns 412 because the
 * extension uses the buyer's stored eBay defaults.
 */

import type { Address, PurchasePaymentInstrument } from "@flipagent/types";
import { sellRequest } from "../ebay/rest/user-client.js";

function requireRest(): void {
	if (!config.EBAY_ORDER_API_APPROVED) {
		throw new PurchaseError(
			"multi_stage_rest_only",
			412,
			"Multi-stage updates only work in REST transport. Set EBAY_ORDER_API_APPROVED=1 once eBay grants Buy Order API access.",
		);
	}
}

export async function updatePurchaseShipping(
	sessionId: string,
	shipTo: Address,
	apiKeyId: string,
): Promise<FlipagentResult<Purchase> | null> {
	requireRest();
	await sellRequest({
		apiKeyId,
		method: "POST",
		path: `/buy/order/v1/checkout_session/${encodeURIComponent(sessionId)}/shipping_address`,
		body: { shippingAddress: addressToEbay(shipTo) },
	});
	return getPurchase(sessionId, apiKeyId);
}

export async function updatePurchasePayment(
	sessionId: string,
	paymentInstruments: PurchasePaymentInstrument[],
	apiKeyId: string,
): Promise<FlipagentResult<Purchase> | null> {
	requireRest();
	await sellRequest({
		apiKeyId,
		method: "POST",
		path: `/buy/order/v1/checkout_session/${encodeURIComponent(sessionId)}/payment_instrument`,
		body: {
			paymentInstruments: paymentInstruments.map((p) => ({
				paymentMethodType: p.paymentMethodType.toUpperCase(),
				...(p.paymentMethodBrand ? { paymentMethodBrand: p.paymentMethodBrand.toUpperCase() } : {}),
				...(p.token ? { token: p.token } : {}),
			})),
		},
	});
	return getPurchase(sessionId, apiKeyId);
}

export async function updatePurchaseCoupon(
	sessionId: string,
	couponCode: string | null,
	apiKeyId: string,
): Promise<FlipagentResult<Purchase> | null> {
	requireRest();
	if (couponCode) {
		await sellRequest({
			apiKeyId,
			method: "POST",
			path: `/buy/order/v1/checkout_session/${encodeURIComponent(sessionId)}/coupon`,
			body: { couponCode },
		});
	} else {
		await sellRequest({
			apiKeyId,
			method: "DELETE",
			path: `/buy/order/v1/checkout_session/${encodeURIComponent(sessionId)}/coupon`,
		});
	}
	return getPurchase(sessionId, apiKeyId);
}

function addressToEbay(a: Address): Record<string, unknown> {
	return {
		recipient: { fullName: a.name ?? "" },
		contactAddress: {
			addressLine1: a.line1,
			...(a.line2 ? { addressLine2: a.line2 } : {}),
			city: a.city,
			...(a.region ? { stateOrProvince: a.region } : {}),
			postalCode: a.postalCode,
			countryCode: a.country,
		},
		...(a.phone ? { primaryPhone: { phoneNumber: a.phone } } : {}),
	};
}

function pickTransport(input: PurchaseCreate, ctx: PurchaseContext): "rest" | "bridge" {
	try {
		const picked = selectTransport("orders.checkout", {
			explicit: input.transport,
			oauthBound: true,
			bridgePaired: ctx.bridgePaired ?? true,
			envFlags: { EBAY_ORDER_API_APPROVED: config.EBAY_ORDER_API_APPROVED },
		});
		// `orders.checkout` only declares rest+bridge in the capability
		// matrix, so the broader `Transport` union narrows to these two
		// at runtime — the cast is sound.
		return picked as "rest" | "bridge";
	} catch (err) {
		if (err instanceof TransportUnavailableError) {
			throw new PurchaseError(
				"transport_unavailable",
				412,
				`No available transport: ${err.message}. Set EBAY_ORDER_API_APPROVED=1 for REST, or pair the Chrome extension for bridge.`,
			);
		}
		throw err;
	}
}
