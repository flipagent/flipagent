/**
 * `client.cart.*` — eBay Buy Browse persistent shopping cart.
 *
 * The seller-managed `/v1/purchases` flow is the primary buy path; cart
 * is here for callers who want eBay's persistent multi-item cart.
 */

import type { Cart, CartAddRequest, CartUpdateQuantityRequest } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface CartClient {
	get(): Promise<Cart>;
	add(body: CartAddRequest): Promise<Cart>;
	updateQuantity(cartItemId: string, quantity: number): Promise<Cart>;
	remove(cartItemId: string): Promise<Cart>;
}

export function createCartClient(http: FlipagentHttp): CartClient {
	return {
		get: () => http.get("/v1/cart"),
		add: (body) => http.post("/v1/cart/items", body),
		updateQuantity: (cartItemId, quantity) =>
			http.patch(`/v1/cart/items/${encodeURIComponent(cartItemId)}`, {
				cartItemId,
				quantity,
			} satisfies CartUpdateQuantityRequest),
		remove: (cartItemId) => http.delete(`/v1/cart/items/${encodeURIComponent(cartItemId)}`),
	};
}
