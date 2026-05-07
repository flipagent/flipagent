/**
 * `POST /v1/purchases` — initiate + place_order in one shot.
 *
 * Public contract from a caller's perspective:
 *   - terminal status (`completed`/`failed`) → done; render the receipt
 *   - non-terminal status with `nextAction` → user action needed; agent
 *     directs the user to `nextAction.url` and polls
 *     `GET /v1/purchases/{id}` until terminal
 *
 * Internally we pick one of three modes (the `orders.checkout` matrix
 * entry exposes rest+bridge+url) — server-side REST, paired Chrome
 * extension, or url deeplink — based on operator config + extension
 * pairing. The picked mode is never exposed on the response shape;
 * callers see the same `Purchase` regardless. The choice is recorded
 * in `bridge_jobs.metadata.transport` for internal observability so
 * the inline-reconcile path on GET can re-attach the right
 * `nextAction` after restarts.
 */

import type { Address, Purchase, PurchaseCreate, PurchasePaymentInstrument } from "@flipagent/types";
import type { LineItem } from "@flipagent/types/ebay/buy";
import { config } from "../../config.js";
import { cancelJob } from "../bridge-jobs.js";
import { reconcileJob } from "../bridge-reconciler.js";
import { sellRequest } from "../ebay/rest/user-client.js";
import { type NextAction, openUrlAction } from "../shared/next-action.js";
import type { FlipagentResult, SourceKind } from "../shared/result.js";
import { selectTransport } from "../shared/transport.js";
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
	const mode = pickMode(ctx);

	// Advanced fields are only honored when the server can place the
	// order directly. Anywhere else they're a no-op risk (the deeplink
	// flow uses the buyer's stored eBay defaults), so 412 with a clean
	// message rather than silently ignoring.
	if (mode !== "rest" && (input.shipTo || input.couponCode || input.paymentInstruments || input.guest)) {
		throw new PurchaseError(
			"advanced_fields_not_supported",
			412,
			"This server can't honor advanced order fields (shipTo / couponCode / paymentInstruments / guest). Submit the items only — the buyer's stored eBay defaults are used.",
		);
	}

	const lineItems: LineItem[] = input.items.map((it) => ({
		itemId: it.itemId,
		quantity: it.quantity ?? 1,
		...(it.variationId ? { variationId: it.variationId } : {}),
	}));

	try {
		// Stage 1 — initiate. Inserts a `buy_checkout_sessions` row.
		const session = await initiateCheckoutSession({
			apiKeyId: ctx.apiKeyId,
			userId: ctx.userId,
			lineItems,
			...(input.shipTo ? { shippingAddresses: [input.shipTo] } : {}),
		});

		// Stage 2 — place_order. Bridge + url enqueue a tracking row;
		// REST hits eBay synchronously. Either way returns an
		// `EbayPurchaseOrder`. The picked mode is stashed in
		// `bridge_jobs.metadata.transport` so polling reads can recover
		// it (and re-attach `nextAction` on url-mode rows).
		const order = await placeOrder(session.checkoutSessionId, ctx.apiKeyId, ctx.userId, mode);
		const body = ebayToPurchase({ order, marketplace: input.marketplace });

		// `nextAction` only appears on url-mode rows. Bridge already
		// opens the tab in the user's browser; REST placed the order
		// server-side.
		if (mode === "url") {
			const first = lineItems[0];
			if (first) {
				body.nextAction = buyDeeplinkAction(first.itemId, first.variationId);
			}
		}

		return { body, source: mode, fromCache: false };
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
	const body = ebayToPurchase({ order: record.order });

	// Re-attach `nextAction` for non-terminal url-mode rows so the
	// agent can re-prompt the user if they walked away from the tab.
	const isTerminal = body.status === "completed" || body.status === "failed" || body.status === "cancelled";
	if (record.transport === "url" && !isTerminal && body.items[0]) {
		body.nextAction = buyDeeplinkAction(body.items[0].itemId, body.items[0].variationId);
	}

	const source: SourceKind = record.transport ?? "url";
	return { body, source, fromCache: false };
}

export async function cancelPurchase(id: string, apiKeyId: string): Promise<FlipagentResult<Purchase> | null> {
	await cancelJob(id, apiKeyId);
	return getPurchase(id, apiKeyId);
}

function pickMode(ctx: PurchaseContext): "rest" | "bridge" | "url" {
	// `orders.checkout` declares rest+bridge+url; url is unconditional,
	// so `selectTransport` always succeeds. The cast narrows the wider
	// `Transport` union to the three modes the resource exposes.
	const picked = selectTransport("orders.checkout", {
		oauthBound: true,
		bridgePaired: ctx.bridgePaired ?? false,
		envFlags: { EBAY_ORDER_APPROVED: config.EBAY_ORDER_APPROVED },
	});
	return picked as "rest" | "bridge" | "url";
}

/* ----- Multi-stage update endpoints ----------------------------------- */
/* Honored only when the server can place the order directly. Otherwise
 * 412 with a clean message — same posture as the advanced-field gate
 * on createPurchase. Intentionally lightweight so flipping server
 * config from "url-only" to "direct placement" doesn't require any
 * client changes. */

function requireDirectPlacement(): void {
	if (!config.EBAY_ORDER_APPROVED) {
		throw new PurchaseError(
			"mid_checkout_updates_not_supported",
			412,
			"This server can't update orders mid-checkout. Submit the items in one call instead.",
		);
	}
}

export async function updatePurchaseShipping(
	sessionId: string,
	shipTo: Address,
	apiKeyId: string,
): Promise<FlipagentResult<Purchase> | null> {
	requireDirectPlacement();
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
	requireDirectPlacement();
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
	requireDirectPlacement();
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
