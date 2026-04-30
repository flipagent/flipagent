/**
 * `/v1/buy/order/*` — eBay Buy Order API surface. **Two first-class
 * transports:**
 *
 *   transport=rest    — pass-through to api.ebay.com Buy Order API
 *                       REST. Requires `EBAY_ORDER_API_APPROVED=1`
 *                       (Limited Release per-tenant approval) AND
 *                       the api key's eBay account connection.
 *   transport=bridge  — flipagent's Chrome extension drives the
 *                       BIN flow inside the buyer's real eBay
 *                       session. Returns the same eBay-shape
 *                       `CheckoutSession` / `EbayPurchaseOrder`.
 *
 * Same URL surface, same response shape — caller doesn't have to
 * know which transport executed. Auto-pick lives in
 * `services/shared/transport.ts`; the route layer just resolves the
 * pick and dispatches.
 *
 * Override per-call with `?transport=rest` or `?transport=bridge`.
 * Without override, `selectTransport` picks REST when the env flag +
 * OAuth are both available, otherwise bridge.
 *
 * Bridge supports the 2-stage flow (`initiate` → `place_order` →
 * poll). Multi-stage update endpoints (`shipping_address`,
 * `payment_instrument`, `coupon`) only work in REST mode — bridge
 * uses the buyer's stored eBay defaults so we 412 there with a
 * pointer to flip the env flag.
 */

import { CheckoutSession, EbayPurchaseOrder, InitiateCheckoutSessionRequest } from "@flipagent/types/ebay/buy";
import type { Context } from "hono";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { config } from "../../../config.js";
import { requireApiKey } from "../../../middleware/auth.js";
import { cancelJob } from "../../../services/bridge-jobs/queue.js";
import {
	BridgeCheckoutError,
	getCheckoutSession,
	getPurchaseOrder,
	initiateCheckoutSession,
	placeOrder,
} from "../../../services/buy/checkout-session.js";
import { ebayPassthroughUser } from "../../../services/ebay/rest/client.js";
import { selectTransport, type Transport, TransportUnavailableError } from "../../../services/shared/transport.js";
import { errorResponse, jsonResponse, tbBody } from "../../../utils/openapi.js";

export const ebayOrderRoute = new Hono();

const responses = {
	200: jsonResponse("eBay-shape response (rest or bridge transport).", EbayPurchaseOrder),
	401: errorResponse("API key missing or eBay account not connected."),
	404: errorResponse("Session or purchase order not found."),
	410: errorResponse("Session expired."),
	412: errorResponse("Bridge transport limitation — REST transport supports the operation."),
	502: errorResponse("Upstream eBay request failed."),
};

/**
 * Pick `rest` or `bridge` for this request. Per-call override via
 * `?transport=`; otherwise the central matrix decides.
 *
 * Note: `oauthBound` is set to true here as a soft default. The
 * eBay-OAuth gate is enforced by `ebayPassthroughUser` (returns 401
 * `ebay_account_not_connected`) when REST is actually invoked, so we
 * don't need to do a DB read to know if the api key has OAuth
 * bound — selectTransport's role is to decide which transport,
 * not to short-circuit auth.
 */
function pickTransport(c: Context): { transport: Transport } | { transport: null; response: Response } {
	const explicit = c.req.query("transport") as Transport | undefined;
	try {
		const transport = selectTransport("orders.checkout", {
			explicit,
			oauthBound: true,
			bridgePaired: true,
			envFlags: { EBAY_ORDER_API_APPROVED: config.EBAY_ORDER_API_APPROVED },
		});
		return { transport };
	} catch (err) {
		if (err instanceof TransportUnavailableError) {
			const code = err.requested === "rest" ? "rest_transport_unavailable" : "transport_unavailable";
			const hint =
				err.requested === "rest"
					? "set EBAY_ORDER_API_APPROVED=1 (after eBay tenant approval) and ensure the api key has eBay OAuth bound, or omit ?transport= to auto-pick bridge"
					: err.message;
			return { transport: null, response: c.json(bridgeErrorBody(code, hint), 412) };
		}
		throw err;
	}
}

function bridgeErrorBody(code: string, message: string) {
	return {
		errors: [
			{
				errorId: 50100,
				domain: "FLIPAGENT",
				category: "REQUEST",
				message,
				longMessage: message,
				parameters: [{ name: "code", value: code }],
			},
		],
	};
}

ebayOrderRoute.post(
	"/checkout_session/initiate",
	describeRoute({
		tags: ["Buy Order"],
		summary: "Start a checkout session (rest or bridge transport)",
		description:
			"eBay shape `CheckoutSession` response. Either transport produces the same payload. With `EBAY_ORDER_API_APPROVED=1` and an eBay-connected api key, the auto-pick uses `rest` (passthrough to api.ebay.com); otherwise `bridge` (server-side session writer; the buy executes when `place_order` runs the bridge task).",
		responses: { ...responses, 200: jsonResponse("Checkout session.", CheckoutSession) },
	}),
	requireApiKey,
	tbBody(InitiateCheckoutSessionRequest),
	async (c) => {
		const pick = pickTransport(c);
		if (pick.transport === null) return pick.response;
		const transport = pick.transport;
		if (transport === "rest") return ebayPassthroughUser(c);
		try {
			const body = c.req.valid("json");
			const session = await initiateCheckoutSession({
				apiKeyId: c.var.apiKey.id,
				userId: c.var.apiKey.userId ?? null,
				lineItems: body.lineItems,
				shippingAddresses: body.shippingAddresses,
				paymentInstruments: body.paymentInstruments,
				pricingSummary: body.pricingSummary,
			});
			return c.json(session);
		} catch (err) {
			if (err instanceof BridgeCheckoutError) {
				return c.json(bridgeErrorBody(err.code, err.message), err.status as 400 | 410 | 412 | 500);
			}
			throw err;
		}
	},
);

ebayOrderRoute.get(
	"/checkout_session/:sessionId",
	describeRoute({
		tags: ["Buy Order"],
		summary: "Get a checkout session",
		responses: { ...responses, 200: jsonResponse("Checkout session.", CheckoutSession) },
	}),
	requireApiKey,
	async (c) => {
		const pick = pickTransport(c);
		if (pick.transport === null) return pick.response;
		const transport = pick.transport;
		if (transport === "rest") return ebayPassthroughUser(c);
		const sessionId = c.req.param("sessionId");
		const session = await getCheckoutSession(sessionId, c.var.apiKey.id);
		if (!session) return c.json(bridgeErrorBody("session_not_found", `No session ${sessionId}`), 404);
		return c.json(session);
	},
);

ebayOrderRoute.post(
	"/checkout_session/:sessionId/place_order",
	describeRoute({
		tags: ["Buy Order"],
		summary: "Place the order (rest or bridge transport)",
		description:
			"Mirror of `placeOrder`. In bridge transport this queues the buy task to the user's paired Chrome extension; status begins `QUEUED_FOR_PROCESSING` and transitions to `PROCESSING` → `PROCESSED` (or `FAILED`) as the extension drives the BIN flow.",
		responses,
	}),
	requireApiKey,
	async (c) => {
		const pick = pickTransport(c);
		if (pick.transport === null) return pick.response;
		const transport = pick.transport;
		if (transport === "rest") return ebayPassthroughUser(c);
		try {
			const sessionId = c.req.param("sessionId");
			const order = await placeOrder(sessionId, c.var.apiKey.id, c.var.apiKey.userId ?? null);
			return c.json(order);
		} catch (err) {
			if (err instanceof BridgeCheckoutError) {
				return c.json(bridgeErrorBody(err.code, err.message), err.status as 400 | 404 | 410 | 412 | 500);
			}
			throw err;
		}
	},
);

ebayOrderRoute.post(
	"/purchase_order/:purchaseOrderId/cancel",
	describeRoute({
		tags: ["Buy Order"],
		summary: "Cancel a non-terminal purchase order (bridge transport only)",
		description:
			"Bridge-only — eBay's Buy Order REST has no public cancel endpoint. Cancels orders that haven't yet been picked up or placed (QUEUED_FOR_PROCESSING / pre-place PROCESSING); once mid-place the cancel is a no-op.",
		responses,
	}),
	requireApiKey,
	async (c) => {
		const pick = pickTransport(c);
		if (pick.transport === null) return pick.response;
		const transport = pick.transport;
		if (transport === "rest") {
			return c.json(
				bridgeErrorBody(
					"cancel_unavailable_in_rest_mode",
					"eBay Buy Order REST has no cancel endpoint; force bridge transport with ?transport=bridge",
				),
				412,
			);
		}
		const id = c.req.param("purchaseOrderId");
		const cancelled = await cancelJob(id, c.var.apiKey.id);
		const order = await getPurchaseOrder(id, c.var.apiKey.id);
		if (!order) return c.json(bridgeErrorBody("purchase_order_not_found", `No purchase order ${id}`), 404);
		void cancelled;
		return c.json(order);
	},
);

ebayOrderRoute.get(
	"/purchase_order/:purchaseOrderId",
	describeRoute({
		tags: ["Buy Order"],
		summary: "Get a purchase order",
		description:
			"Mirror of `getPurchaseOrder`. Bridge transport maps the bridge-queue row to eBay's `EbayPurchaseOrder` shape (status enum: QUEUED_FOR_PROCESSING / PROCESSING / PROCESSED / FAILED / CANCELED).",
		responses,
	}),
	requireApiKey,
	async (c) => {
		const pick = pickTransport(c);
		if (pick.transport === null) return pick.response;
		const transport = pick.transport;
		if (transport === "rest") return ebayPassthroughUser(c);
		const id = c.req.param("purchaseOrderId");
		const order = await getPurchaseOrder(id, c.var.apiKey.id);
		if (!order) return c.json(bridgeErrorBody("purchase_order_not_found", `No purchase order ${id}`), 404);
		return c.json(order);
	},
);

/* ----- multi-stage update endpoints — REST-only -----
 * eBay's REST surface supports custom shipping_address /
 * payment_instrument / coupon mid-checkout. Bridge transport uses
 * the buyer's stored eBay defaults; these flip 412 with a clear
 * pointer to switch transport.
 */

const REST_OR_412 = (reason: string) => async (c: Context) => {
	const pick = pickTransport(c);
	if (pick.transport === null) return pick.response;
	const transport = pick.transport;
	if (transport === "rest") return ebayPassthroughUser(c);
	return c.json(bridgeErrorBody("bridge_transport_limitation", reason), 412);
};

ebayOrderRoute.post(
	"/checkout_session/:sessionId/shipping_address",
	describeRoute({ tags: ["Buy Order"], summary: "Set shipping address (REST transport only)", responses }),
	requireApiKey,
	REST_OR_412(
		"bridge transport uses the buyer's default eBay shipping address; switch with ?transport=rest (requires EBAY_ORDER_API_APPROVED=1)",
	),
);

ebayOrderRoute.post(
	"/checkout_session/:sessionId/payment_instrument",
	describeRoute({ tags: ["Buy Order"], summary: "Set payment instrument (REST transport only)", responses }),
	requireApiKey,
	REST_OR_412(
		"bridge transport uses the buyer's default eBay payment method; switch with ?transport=rest (requires EBAY_ORDER_API_APPROVED=1)",
	),
);

ebayOrderRoute.put(
	"/checkout_session/:sessionId/payment_instrument",
	describeRoute({ tags: ["Buy Order"], summary: "Update payment instrument (REST transport only)", responses }),
	requireApiKey,
	REST_OR_412(
		"bridge transport uses the buyer's default eBay payment method; switch with ?transport=rest (requires EBAY_ORDER_API_APPROVED=1)",
	),
);

ebayOrderRoute.delete(
	"/checkout_session/:sessionId/payment_instrument",
	describeRoute({ tags: ["Buy Order"], summary: "Delete payment instrument (REST transport only)", responses }),
	requireApiKey,
	REST_OR_412(
		"bridge transport uses the buyer's default eBay payment method; switch with ?transport=rest (requires EBAY_ORDER_API_APPROVED=1)",
	),
);

ebayOrderRoute.post(
	"/checkout_session/:sessionId/coupon",
	describeRoute({ tags: ["Buy Order"], summary: "Apply coupon (REST transport only)", responses }),
	requireApiKey,
	REST_OR_412(
		"bridge transport doesn't apply coupons mid-checkout; switch with ?transport=rest (requires EBAY_ORDER_API_APPROVED=1)",
	),
);

ebayOrderRoute.delete(
	"/checkout_session/:sessionId/coupon",
	describeRoute({ tags: ["Buy Order"], summary: "Remove coupon (REST transport only)", responses }),
	requireApiKey,
	REST_OR_412(
		"bridge transport doesn't apply coupons mid-checkout; switch with ?transport=rest (requires EBAY_ORDER_API_APPROVED=1)",
	),
);
