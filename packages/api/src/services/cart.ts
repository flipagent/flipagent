/**
 * `/v1/cart` — eBay Buy Browse shopping_cart, REST. Wrapped here for
 * callers who want eBay's persistent multi-item cart; the primary buy
 * flow is `/v1/purchases` (bridge + REST transports). Both buy paths
 * coexist — cart is a buyer-side persistent intent surface, purchases
 * is a single-shot place-order surface.
 *
 * All four endpoints require user OAuth (the cart is bound to the
 * eBay-connected account behind the api-key).
 */

import type {
	Cart,
	CartAddRequest,
	CartLineItem,
	CartRemoveRequest,
	CartUpdateQuantityRequest,
} from "@flipagent/types";
import { sellRequest } from "./ebay/rest/user-client.js";
import { moneyFrom } from "./shared/money.js";

export interface CartContext {
	apiKeyId: string;
	marketplace?: string;
}

interface EbayCartLineItem {
	cartItemId: string;
	itemId: string;
	quantity: number;
	title?: string;
	image?: { imageUrl: string };
	price?: { value: string; currency: string };
	deliveryCost?: { shippingCost?: { value: string; currency: string } };
	lineItemCost?: { value: string; currency: string };
}

interface EbayCart {
	lineItems?: EbayCartLineItem[];
	subtotal?: { value: string; currency: string };
}

function ebayCartToFlipagent(c: EbayCart): Cart {
	const lineItems: CartLineItem[] = (c.lineItems ?? []).map((li) => ({
		cartItemId: li.cartItemId,
		itemId: li.itemId,
		quantity: li.quantity,
		...(li.title ? { title: li.title } : {}),
		...(li.image?.imageUrl ? { image: li.image.imageUrl } : {}),
		...(moneyFrom(li.price) ? { price: moneyFrom(li.price)! } : {}),
		...(moneyFrom(li.deliveryCost?.shippingCost) ? { shippingCost: moneyFrom(li.deliveryCost?.shippingCost)! } : {}),
		...(moneyFrom(li.lineItemCost) ? { total: moneyFrom(li.lineItemCost)! } : {}),
	}));
	return {
		marketplace: "ebay_us",
		lineItems,
		...(moneyFrom(c.subtotal) ? { subtotal: moneyFrom(c.subtotal)! } : {}),
	};
}

export async function getCart(ctx: CartContext): Promise<Cart> {
	const res = await sellRequest<EbayCart>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: "/buy/browse/v1/shopping_cart",
		marketplace: ctx.marketplace,
	});
	return ebayCartToFlipagent(res ?? {});
}

export async function addToCart(input: CartAddRequest, ctx: CartContext): Promise<Cart> {
	const res = await sellRequest<EbayCart>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/buy/browse/v1/shopping_cart/add_item",
		body: { itemId: input.itemId, quantity: input.quantity },
		marketplace: ctx.marketplace,
	});
	return ebayCartToFlipagent(res ?? {});
}

export async function removeFromCart(input: CartRemoveRequest, ctx: CartContext): Promise<Cart> {
	const res = await sellRequest<EbayCart>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/buy/browse/v1/shopping_cart/remove_item",
		body: { cartItemId: input.cartItemId },
		marketplace: ctx.marketplace,
	});
	return ebayCartToFlipagent(res ?? {});
}

export async function updateCartQuantity(input: CartUpdateQuantityRequest, ctx: CartContext): Promise<Cart> {
	const res = await sellRequest<EbayCart>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/buy/browse/v1/shopping_cart/update_quantity",
		body: { cartItemId: input.cartItemId, quantity: input.quantity },
		marketplace: ctx.marketplace,
	});
	return ebayCartToFlipagent(res ?? {});
}
