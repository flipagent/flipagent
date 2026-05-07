/**
 * `/v1/cart` — eBay Buy Browse persistent shopping cart.
 *
 *   GET    /v1/cart                  read the cart
 *   POST   /v1/cart/items            add an item
 *   PATCH  /v1/cart/items/:cartItemId  update quantity
 *   DELETE /v1/cart/items/:cartItemId  remove an item
 *
 * The seller-managed `/v1/purchases` flow is the primary buy path; cart
 * is here for callers who want eBay's persistent multi-item cart.
 */

import { Cart, CartAddRequest, CartUpdateQuantityRequest } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { addToCart, getCart, removeFromCart, updateCartQuantity } from "../../services/cart.js";
import { ebayMarketplaceId } from "../../services/shared/marketplace.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const cartRoute = new Hono();

const COMMON = {
	401: errorResponse("API key missing or eBay account not connected."),
	502: errorResponse("Upstream eBay request failed."),
};

cartRoute.get(
	"/",
	describeRoute({
		tags: ["Cart"],
		summary: "Get the eBay shopping cart",
		responses: { 200: jsonResponse("Cart.", Cart), ...COMMON },
	}),
	requireApiKey,
	async (c) =>
		c.json({
			...(await getCart({
				apiKeyId: c.var.apiKey.id,
				marketplace: ebayMarketplaceId(),
			})),
		}),
);

cartRoute.post(
	"/items",
	describeRoute({
		tags: ["Cart"],
		summary: "Add an item to the cart",
		responses: { 200: jsonResponse("Cart.", Cart), ...COMMON },
	}),
	requireApiKey,
	tbBody(CartAddRequest),
	async (c) =>
		c.json({
			...(await addToCart(c.req.valid("json"), {
				apiKeyId: c.var.apiKey.id,
				marketplace: ebayMarketplaceId(),
			})),
		}),
);

cartRoute.patch(
	"/items/:cartItemId",
	describeRoute({
		tags: ["Cart"],
		summary: "Update a cart line-item's quantity",
		responses: { 200: jsonResponse("Cart.", Cart), ...COMMON },
	}),
	requireApiKey,
	tbBody(CartUpdateQuantityRequest),
	async (c) => {
		const body = c.req.valid("json");
		return c.json({
			...(await updateCartQuantity(
				{ cartItemId: c.req.param("cartItemId"), quantity: body.quantity },
				{ apiKeyId: c.var.apiKey.id, marketplace: ebayMarketplaceId() },
			)),
		});
	},
);

cartRoute.delete(
	"/items/:cartItemId",
	describeRoute({
		tags: ["Cart"],
		summary: "Remove an item from the cart",
		responses: { 200: jsonResponse("Cart.", Cart), ...COMMON },
	}),
	requireApiKey,
	async (c) =>
		c.json({
			...(await removeFromCart(
				{ cartItemId: c.req.param("cartItemId") },
				{ apiKeyId: c.var.apiKey.id, marketplace: ebayMarketplaceId() },
			)),
		}),
);
