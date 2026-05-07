/**
 * `/v1/cart` — eBay Buy Browse shopping cart (REST). Multi-item cart that
 * lives on eBay's side; the seller-managed `/v1/purchases` flow is the
 * primary way to buy through flipagent (single-shot bridge / REST). Cart
 * is here for callers who want eBay's persistent cart semantics across
 * sessions (a buyer browsing a long-tail category for hours).
 *
 * The cart is owned by the api-key's bound eBay account — `requireApiKey`
 * + a connected eBay binding. Anonymous keys can't read/write cart.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Marketplace, Money } from "./_common.js";

export const CartLineItem = Type.Object(
	{
		cartItemId: Type.String(),
		itemId: Type.String(),
		quantity: Type.Integer({ minimum: 1 }),
		title: Type.Optional(Type.String()),
		image: Type.Optional(Type.String()),
		price: Type.Optional(Money),
		shippingCost: Type.Optional(Money),
		total: Type.Optional(Money),
	},
	{ $id: "CartLineItem" },
);
export type CartLineItem = Static<typeof CartLineItem>;

export const Cart = Type.Object(
	{
		marketplace: Marketplace,
		lineItems: Type.Array(CartLineItem),
		subtotal: Type.Optional(Money),
	},
	{ $id: "Cart" },
);
export type Cart = Static<typeof Cart>;

export const CartAddRequest = Type.Object(
	{
		itemId: Type.String(),
		quantity: Type.Integer({ minimum: 1, default: 1 }),
	},
	{ $id: "CartAddRequest" },
);
export type CartAddRequest = Static<typeof CartAddRequest>;

export const CartRemoveRequest = Type.Object({ cartItemId: Type.String() }, { $id: "CartRemoveRequest" });
export type CartRemoveRequest = Static<typeof CartRemoveRequest>;

export const CartUpdateQuantityRequest = Type.Object(
	{
		cartItemId: Type.String(),
		quantity: Type.Integer({ minimum: 1 }),
	},
	{ $id: "CartUpdateQuantityRequest" },
);
export type CartUpdateQuantityRequest = Static<typeof CartUpdateQuantityRequest>;
