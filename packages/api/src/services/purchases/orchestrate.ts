/**
 * `POST /v1/purchases` — initiate + place_order in one shot.
 *
 * Three transports surface through the same `Purchase` shape:
 *   - "rest"   eBay's Buy Order REST places the order server-side
 *              (gated by EBAY_ORDER_APPROVED + user OAuth)
 *   - "bridge" paired Chrome extension claims a tracking row, opens
 *              the ebay.com/itm tab, shows a cap-validation banner,
 *              and captures the orderId off /vod/ for fast
 *              reconciliation
 *   - "url"    deeplink mode (no extension needed): the API returns
 *              `nextAction.url` pointing at the ebay.com/itm page;
 *              the user clicks Buy It Now → Confirm and pay on
 *              eBay's own UI. The Trading-API reconciler matches the
 *              resulting order against a snapshot captured at queue
 *              time so the agent's next `GET /v1/purchases/{id}`
 *              flips the row from `processing` → `completed` once
 *              eBay confirms.
 *
 * `selectTransport` picks rest → bridge → url in that order based on
 * EBAY_ORDER_APPROVED + extension pairing. All three persist a
 * tracking row (via `bridge-session.ts`) so cancel + status-poll +
 * list reuse the same code.
 */

import type { Purchase, PurchaseCreate } from "@flipagent/types";
import type { LineItem } from "@flipagent/types/ebay/buy";
import { config } from "../../config.js";
import { cancelJob } from "../bridge-jobs.js";
import { reconcileJob } from "../bridge-reconciler.js";
import { type NextAction, openUrlAction } from "../shared/next-action.js";
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

function ebayItemUrl(itemId: string, variationId: string | undefined): string {
	const base = `https://www.ebay.com/itm/${encodeURIComponent(itemId)}`;
	return variationId ? `${base}?var=${encodeURIComponent(variationId)}` : base;
}

function buyDeeplinkAction(itemId: string, variationId: string | undefined): NextAction {
	return openUrlAction(
		ebayItemUrl(itemId, variationId),
		'Direct the user to this URL to complete the purchase. They click Buy It Now → Confirm and pay on eBay\'s own UI. flipagent reconciles completion against the buyer\'s WonList — call GET /v1/purchases/{id} a few seconds after the user clicks through to see status flip from "processing" to "completed".',
	);
}

export async function createPurchase(input: PurchaseCreate, ctx: PurchaseContext): Promise<FlipagentResult<Purchase>> {
	const transport = pickTransport(input, ctx);

	// REST-only fields. Bridge + url both rely on the buyer's stored
	// eBay defaults (the user is on eBay's own UI for the actual click).
	if (input.shipTo && transport !== "rest") {
		throw new PurchaseError(
			"shipTo_unsupported_outside_rest",
			412,
			`\`shipTo\` overrides only work in REST transport — ${transport} transport uses the buyer's stored eBay default. Set \`transport='rest'\` (requires EBAY_ORDER_APPROVED=1) or remove \`shipTo\`.`,
		);
	}
	if (input.couponCode && transport !== "rest") {
		throw new PurchaseError(
			"coupon_unsupported_outside_rest",
			412,
			`\`couponCode\` only works in REST transport. Set \`transport='rest'\` or remove the field.`,
		);
	}

	const lineItems: LineItem[] = input.items.map((it) => ({
		itemId: it.itemId,
		quantity: it.quantity ?? 1,
		...(it.variationId ? { variationId: it.variationId } : {}),
	}));

	try {
		// Stage 1 — initiate. Same call for both transports; in REST mode
		// the underlying service forwards to api.ebay.com, in bridge/url
		// mode it inserts a `buy_checkout_sessions` row.
		const session = await initiateCheckoutSession({
			apiKeyId: ctx.apiKeyId,
			userId: ctx.userId,
			lineItems,
			...(input.shipTo ? { shippingAddresses: [input.shipTo] } : {}),
		});

		// Stage 2 — place_order. Bridge + url both enqueue a tracking
		// row (the picked transport is stashed in metadata so polling
		// reads can recover it); REST hits eBay synchronously. Either
		// way returns an `EbayPurchaseOrder`.
		const order = await placeOrder(session.checkoutSessionId, ctx.apiKeyId, ctx.userId, transport);
		const body = ebayToPurchase({ order, transport, marketplace: input.marketplace });

		// `nextAction` is only meaningful for url transport — agent/UI
		// shows the deeplink to drive the user to the listing. Bridge
		// already opens the tab in the user's browser; REST placed the
		// order server-side.
		if (transport === "url") {
			const first = lineItems[0];
			if (first) {
				body.nextAction = buyDeeplinkAction(first.itemId, first.variationId);
			}
		}

		return { body, source: transport, fromCache: false };
	} catch (err) {
		if (err instanceof BridgeCheckoutError) {
			throw new PurchaseError(err.code, err.status, err.message);
		}
		throw err;
	}
}

export async function getPurchase(id: string, apiKeyId: string): Promise<FlipagentResult<Purchase> | null> {
	// Lazy reconcile: if this is an in-flight tracking row for an eBay
	// buy, run one Trading API check first. Converts polling agents
	// into the reconciliation engine — no dependency on the worker
	// tick — so a happy-path purchase flips from `processing` →
	// `completed` on the very next GET after the user clicks
	// "Confirm and pay". No-op for terminal jobs.
	await reconcileJob(id, apiKeyId).catch((err) => console.warn("[getPurchase] inline reconcile failed:", err));

	const record = await getPurchaseOrder(id, apiKeyId);
	if (!record) return null;
	const body = ebayToPurchase({ order: record.order, ...(record.transport ? { transport: record.transport } : {}) });
	const source: SourceKind = record.transport ?? "url";
	return { body, source, fromCache: false };
}

export async function cancelPurchase(id: string, apiKeyId: string): Promise<FlipagentResult<Purchase> | null> {
	await cancelJob(id, apiKeyId);
	return getPurchase(id, apiKeyId);
}

/**
 * Multi-stage update endpoints — REST transport only. eBay's Buy
 * Order REST exposes shipping_address, payment_instrument, coupon
 * patches mid-checkout. Bridge + url transports return 412 because
 * the user uses their stored eBay defaults on eBay's own UI.
 */

import type { Address, PurchasePaymentInstrument } from "@flipagent/types";
import { sellRequest } from "../ebay/rest/user-client.js";

function requireRest(): void {
	if (!config.EBAY_ORDER_APPROVED) {
		throw new PurchaseError(
			"multi_stage_rest_only",
			412,
			"Multi-stage updates only work in REST transport. Set EBAY_ORDER_APPROVED=1 once eBay grants Buy Order API access.",
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

function pickTransport(input: PurchaseCreate, ctx: PurchaseContext): "rest" | "bridge" | "url" {
	try {
		const picked = selectTransport("orders.checkout", {
			explicit: input.transport,
			oauthBound: true,
			bridgePaired: ctx.bridgePaired ?? false,
			envFlags: { EBAY_ORDER_APPROVED: config.EBAY_ORDER_APPROVED },
		});
		// `orders.checkout` only declares rest+bridge+url in the
		// capability matrix, so the broader `Transport` union narrows
		// to these three at runtime — the cast is sound.
		return picked as "rest" | "bridge" | "url";
	} catch (err) {
		if (err instanceof TransportUnavailableError) {
			// `url` is unconditional in the capability matrix, so this
			// branch is unreachable today — the typed throw stays so
			// future capability changes surface clearly.
			throw new PurchaseError("transport_unavailable", 412, err.message);
		}
		throw err;
	}
}
