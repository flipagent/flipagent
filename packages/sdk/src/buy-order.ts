/**
 * `client.buy.order.*` — eBay Buy Order API surface.
 *
 * Single surface, dual transport behind it on the server:
 *
 *   EBAY_ORDER_API_APPROVED=1 → REST passthrough to api.ebay.com
 *   otherwise                 → bridge implementation (Chrome
 *                               extension drives BIN, status mapped
 *                               to eBay shape)
 *
 *   client.buy.order.checkoutSession.initiate(req)        — start a session
 *   client.buy.order.checkoutSession.get(sessionId)       — read session
 *   client.buy.order.checkoutSession.placeOrder(sessionId) — execute the buy
 *   client.buy.order.purchaseOrder.get(purchaseOrderId)   — poll outcome
 *   client.buy.order.quickCheckout(item)                  — convenience: 2-step in 1
 *
 * In bridge mode, the multi-stage update endpoints (shipping_address,
 * payment_instrument, coupon) return 412 — the extension uses the
 * buyer's eBay account defaults.
 */

import type { CheckoutSession, EbayPurchaseOrder, InitiateCheckoutSessionRequest } from "@flipagent/types/ebay/buy";
import type { FlipagentHttp } from "./http.js";

export interface QuickCheckoutInput {
	itemId: string;
	quantity?: number;
	variationId?: string;
}

export interface BuyOrderClient {
	checkoutSession: {
		initiate(req: InitiateCheckoutSessionRequest): Promise<CheckoutSession>;
		get(sessionId: string): Promise<CheckoutSession>;
		placeOrder(sessionId: string): Promise<EbayPurchaseOrder>;
	};
	purchaseOrder: {
		get(purchaseOrderId: string): Promise<EbayPurchaseOrder>;
	};
	/**
	 * Convenience for callers who don't need the multi-stage flow:
	 * runs `initiate` + `placeOrder` in one shot. Returns the
	 * `EbayPurchaseOrder` from `placeOrder` (initial status will be
	 * `QUEUED_FOR_PROCESSING`; poll `purchaseOrder.get(id)` until
	 * terminal).
	 */
	quickCheckout(input: QuickCheckoutInput): Promise<EbayPurchaseOrder>;
}

export function createBuyOrderClient(http: FlipagentHttp): BuyOrderClient {
	return {
		checkoutSession: {
			initiate: (req) => http.post<CheckoutSession>("/v1/buy/order/checkout_session/initiate", req),
			get: (sessionId) =>
				http.get<CheckoutSession>(`/v1/buy/order/checkout_session/${encodeURIComponent(sessionId)}`),
			placeOrder: (sessionId) =>
				http.post<EbayPurchaseOrder>(
					`/v1/buy/order/checkout_session/${encodeURIComponent(sessionId)}/place_order`,
					{},
				),
		},
		purchaseOrder: {
			get: (purchaseOrderId) =>
				http.get<EbayPurchaseOrder>(`/v1/buy/order/purchase_order/${encodeURIComponent(purchaseOrderId)}`),
		},
		quickCheckout: async (input) => {
			const session = await http.post<CheckoutSession>("/v1/buy/order/checkout_session/initiate", {
				lineItems: [
					{
						itemId: input.itemId,
						quantity: input.quantity ?? 1,
						...(input.variationId ? { variationId: input.variationId } : {}),
					},
				],
			});
			return http.post<EbayPurchaseOrder>(
				`/v1/buy/order/checkout_session/${encodeURIComponent(session.checkoutSessionId)}/place_order`,
				{},
			);
		},
	};
}
