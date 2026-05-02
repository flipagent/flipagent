/**
 * `/v1/listings/*` — flipagent-native sell-side surface.
 *
 *   POST   /v1/listings              one-shot create (inventory_item → offer → publish)
 *   GET    /v1/listings              list mine
 *   GET    /v1/listings/{sku}        single listing by SKU
 *   PATCH  /v1/listings/{sku}        update price/qty/aspects/etc
 *   DELETE /v1/listings/{sku}        end (withdraw + delete inventory)
 *   POST   /v1/listings/{sku}/relist re-publish a draft / withdrawn offer
 *
 * `id` in the URL is the SKU (caller-supplied or flipagent-generated)
 * because that's the stable handle across eBay's inventory_item +
 * offer + listing lifecycle. `Listing.id` in the response body is
 * eBay's numeric listing id once the offer is published.
 */

import {
	ListingCreate,
	ListingPreviewFeesRequest,
	ListingPreviewFeesResponse,
	ListingResponse,
	ListingsListQuery,
	ListingsListResponse,
	ListingUpdate,
	ListingVerifyRequest,
	ListingVerifyResponse,
} from "@flipagent/types";
import type { Context } from "hono";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { withTradingAuth } from "../../middleware/with-trading-auth.js";
import { EbayApiError } from "../../services/ebay/rest/user-client.js";
import { createListing, MissingPrereqError, PublishFailedError } from "../../services/listings/create.js";
import { getListing, listListings } from "../../services/listings/get.js";
import { endListing, relistListing, updateListing } from "../../services/listings/lifecycle.js";
import { previewListingFees } from "../../services/listings/preview-fees.js";
import { verifyListing } from "../../services/listings/verify.js";
import { nextAction } from "../../services/shared/next-action.js";
import { errorResponse, jsonResponse, paramsFor, tbBody, tbCoerce } from "../../utils/openapi.js";

export const listingsRoute = new Hono();

const COMMON_RESPONSES = {
	401: errorResponse("API key missing or eBay account not connected (POST /v1/connect/ebay)."),
	412: errorResponse("Missing prerequisite — policies or merchant location not set."),
	502: errorResponse("Upstream eBay request failed."),
	503: errorResponse("EBAY_CLIENT_ID/SECRET/RU_NAME unset on this api instance."),
};

function mapEbayError(c: Context, err: unknown) {
	if (err instanceof MissingPrereqError) {
		return c.json({ error: err.code, message: err.message }, 412);
	}
	if (err instanceof PublishFailedError) {
		return c.json({ error: "publish_failed", message: err.message, partial: err.partial }, 502);
	}
	if (err instanceof EbayApiError) {
		const next_action = err.nextActionKind ? nextAction(c, err.nextActionKind) : undefined;
		return c.json(
			{
				error: err.code,
				message: err.message,
				upstream: err.upstream,
				...(next_action ? { next_action } : {}),
			},
			err.status as 401 | 412 | 502 | 503,
		);
	}
	return null;
}

listingsRoute.post(
	"/verify",
	describeRoute({
		tags: ["Listings"],
		summary: "Dry-run a listing (VerifyAddItem) — returns fees + errors without publishing",
		responses: {
			200: jsonResponse("Verification.", ListingVerifyResponse),
			401: errorResponse("Auth missing."),
			502: errorResponse("Trading API failed."),
		},
	}),
	requireApiKey,
	tbBody(ListingVerifyRequest),
	withTradingAuth(async (c, accessToken) => {
		const body = (await c.req.json()) as ListingVerifyRequest;
		return c.json({ ...(await verifyListing(accessToken, body)), source: "trading" as const });
	}),
);

listingsRoute.post(
	"/",
	describeRoute({
		tags: ["Listings"],
		summary: "Create a listing (one-shot publish)",
		description:
			"Compresses eBay's three-step Sell Inventory dance (PUT inventory_item → POST offer → POST publish) into one call. Returns the live `Listing` with `status='active'` on success. Required: `policies` (fulfillment/payment/return ids) + `merchantLocationKey`. Auto-discovery of those is a future enhancement.",
		responses: {
			201: jsonResponse("Listing created and live.", ListingResponse),
			400: errorResponse("Validation failed."),
			...COMMON_RESPONSES,
		},
	}),
	requireApiKey,
	tbBody(ListingCreate),
	async (c) => {
		const body = c.req.valid("json");
		try {
			const result = await createListing(body, { apiKeyId: c.var.apiKey.id });
			return c.json(result.listing, 201);
		} catch (err) {
			const mapped = mapEbayError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);

listingsRoute.get(
	"/",
	describeRoute({
		tags: ["Listings"],
		summary: "List my listings",
		description: "Paginated list of my inventory + offers, merged into the `Listing` shape.",
		parameters: paramsFor("query", ListingsListQuery),
		responses: {
			200: jsonResponse("Listings page.", ListingsListResponse),
			...COMMON_RESPONSES,
		},
	}),
	requireApiKey,
	tbCoerce("query", ListingsListQuery),
	async (c) => {
		const query = c.req.valid("query");
		try {
			const result = await listListings(
				{ limit: query.limit, offset: query.offset },
				{ apiKeyId: c.var.apiKey.id, marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID") },
			);
			const filtered = query.status ? result.listings.filter((l) => l.status === query.status) : result.listings;
			const body: ListingsListResponse = {
				listings: filtered,
				limit: result.limit,
				offset: result.offset,
				...(result.total !== undefined ? { total: result.total } : {}),
				source: "rest",
			};
			return c.json(body);
		} catch (err) {
			const mapped = mapEbayError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);

listingsRoute.get(
	"/:sku",
	describeRoute({
		tags: ["Listings"],
		summary: "Get a listing by SKU",
		responses: {
			200: jsonResponse("Listing.", ListingResponse),
			404: errorResponse("Listing not found."),
			...COMMON_RESPONSES,
		},
	}),
	requireApiKey,
	async (c) => {
		const sku = c.req.param("sku");
		try {
			const listing = await getListing(sku, {
				apiKeyId: c.var.apiKey.id,
				marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
			});
			if (!listing) {
				return c.json({ error: "listing_not_found", message: `No listing for SKU '${sku}'.` }, 404);
			}
			return c.json(listing);
		} catch (err) {
			const mapped = mapEbayError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);

listingsRoute.patch(
	"/:sku",
	describeRoute({
		tags: ["Listings"],
		summary: "Update a listing",
		description: "Patch price, quantity, aspects, images, etc. Title is a full replace per eBay semantics.",
		responses: {
			200: jsonResponse("Updated listing.", ListingResponse),
			404: errorResponse("Listing not found."),
			...COMMON_RESPONSES,
		},
	}),
	requireApiKey,
	tbBody(ListingUpdate),
	async (c) => {
		const sku = c.req.param("sku");
		const patch = c.req.valid("json");
		try {
			const listing = await updateListing(sku, patch, {
				apiKeyId: c.var.apiKey.id,
				marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
			});
			if (!listing) {
				return c.json({ error: "listing_not_found", message: `No listing for SKU '${sku}'.` }, 404);
			}
			return c.json(listing);
		} catch (err) {
			const mapped = mapEbayError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);

listingsRoute.delete(
	"/:sku",
	describeRoute({
		tags: ["Listings"],
		summary: "End a listing",
		description: "Withdraws the offer (if active) and deletes the inventory item.",
		responses: {
			200: jsonResponse("Listing ended.", ListingResponse),
			404: errorResponse("Listing not found."),
			...COMMON_RESPONSES,
		},
	}),
	requireApiKey,
	async (c) => {
		const sku = c.req.param("sku");
		try {
			const listing = await endListing(sku, {
				apiKeyId: c.var.apiKey.id,
				marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
			});
			if (!listing) {
				return c.json({ error: "listing_not_found", message: `No listing for SKU '${sku}'.` }, 404);
			}
			return c.json(listing);
		} catch (err) {
			const mapped = mapEbayError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);

listingsRoute.post(
	"/preview-fees",
	describeRoute({
		tags: ["Listings"],
		summary: "Preview eBay fees for unpublished offer drafts",
		description:
			"Wraps Sell Inventory `POST /offer/get_listing_fees`. Pass an array of UNPUBLISHED `offerId` values (errors with 25754 on published offers). Returns fees grouped by marketplace — eBay does not break out fees per offer. For 'estimate fees on a hypothetical listing I haven't drafted yet', use POST /v1/listings/verify instead.",
		responses: {
			200: jsonResponse("Fees grouped by marketplace.", ListingPreviewFeesResponse),
			...COMMON_RESPONSES,
		},
	}),
	requireApiKey,
	tbBody(ListingPreviewFeesRequest),
	async (c) => {
		const body = (await c.req.json()) as ListingPreviewFeesRequest;
		try {
			const result = await previewListingFees({ apiKeyId: c.var.apiKey.id, offerIds: body.offerIds });
			return c.json({ ...result, source: "rest" as const });
		} catch (err) {
			const mapped = mapEbayError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);

listingsRoute.post(
	"/:sku/relist",
	describeRoute({
		tags: ["Listings"],
		summary: "Re-publish a draft / withdrawn listing",
		description:
			"Re-runs the eBay publish step against the existing offer. Used to recover after a publish-step failure.",
		responses: {
			200: jsonResponse("Listing relisted.", ListingResponse),
			404: errorResponse("Listing not found."),
			...COMMON_RESPONSES,
		},
	}),
	requireApiKey,
	async (c) => {
		const sku = c.req.param("sku");
		try {
			const listing = await relistListing(sku, {
				apiKeyId: c.var.apiKey.id,
				marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
			});
			if (!listing) {
				return c.json({ error: "listing_not_found", message: `No listing for SKU '${sku}'.` }, 404);
			}
			return c.json(listing);
		} catch (err) {
			const mapped = mapEbayError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);
