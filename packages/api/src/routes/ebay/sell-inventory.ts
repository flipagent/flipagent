/**
 * eBay Sell Inventory API mirror. Used by resellers to create + manage
 * listings. Each handler proxies to api.ebay.com using the api-key's
 * connected eBay refresh token (see /v1/connect/ebay).
 *
 *   PUT/GET/DELETE /sell/inventory/v1/inventory_item/{sku}
 *   POST           /sell/inventory/v1/offer
 *   GET/PUT/DELETE /sell/inventory/v1/offer/{offerId}
 *   POST           /sell/inventory/v1/offer/{offerId}/publish
 *   POST           /sell/inventory/v1/offer/{offerId}/withdraw
 *   POST           /sell/inventory/v1/location/{merchantLocationKey}
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { ebayPassthroughUser } from "../../proxy/ebay-passthrough.js";
import { errorResponse } from "../../utils/openapi.js";

export const ebaySellInventoryRoute = new Hono();

const passthroughResponses = {
	200: { description: "Forwarded from api.ebay.com." },
	401: errorResponse("API key missing or eBay account not connected (POST /v1/connect/ebay)."),
	502: errorResponse("Upstream eBay request failed."),
	503: errorResponse("EBAY_CLIENT_ID/SECRET/RU_NAME unset on this api instance."),
};

ebaySellInventoryRoute.put(
	"/inventory_item/:sku",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Create or replace an inventory item",
		description: "Mirror of Sell Inventory `createOrReplaceInventoryItem`.",
		responses: passthroughResponses,
	}),
	ebayPassthroughUser,
);

ebaySellInventoryRoute.get(
	"/inventory_item/:sku",
	describeRoute({ tags: ["eBay-compat"], summary: "Get an inventory item", responses: passthroughResponses }),
	ebayPassthroughUser,
);

ebaySellInventoryRoute.delete(
	"/inventory_item/:sku",
	describeRoute({ tags: ["eBay-compat"], summary: "Delete an inventory item", responses: passthroughResponses }),
	ebayPassthroughUser,
);

ebaySellInventoryRoute.post(
	"/offer",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Create an offer for an inventory item",
		description: "Mirror of Sell Inventory `createOffer`. The bridge between SKU and live listing.",
		responses: passthroughResponses,
	}),
	ebayPassthroughUser,
);

ebaySellInventoryRoute.get(
	"/offer/:offerId",
	describeRoute({ tags: ["eBay-compat"], summary: "Get an offer", responses: passthroughResponses }),
	ebayPassthroughUser,
);

ebaySellInventoryRoute.put(
	"/offer/:offerId",
	describeRoute({ tags: ["eBay-compat"], summary: "Update an offer", responses: passthroughResponses }),
	ebayPassthroughUser,
);

ebaySellInventoryRoute.delete(
	"/offer/:offerId",
	describeRoute({ tags: ["eBay-compat"], summary: "Delete an offer", responses: passthroughResponses }),
	ebayPassthroughUser,
);

ebaySellInventoryRoute.post(
	"/offer/:offerId/publish",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Publish an offer (go live)",
		description: "Mirror of Sell Inventory `publishOffer`. Turns the offer into an active eBay listing.",
		responses: passthroughResponses,
	}),
	ebayPassthroughUser,
);

ebaySellInventoryRoute.post(
	"/offer/:offerId/withdraw",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Withdraw a published offer",
		responses: passthroughResponses,
	}),
	ebayPassthroughUser,
);

ebaySellInventoryRoute.post(
	"/location/:merchantLocationKey",
	describeRoute({
		tags: ["eBay-compat"],
		summary: "Create a merchant location",
		description: "Required before offers can be created. Mirror of `createInventoryLocation`.",
		responses: passthroughResponses,
	}),
	ebayPassthroughUser,
);
