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
	ItemGroupActionRequest,
	ItemGroupPublishResponse,
	ListingCreate,
	ListingDraftRequest,
	ListingDraftResponse,
	ListingPreviewFeesRequest,
	ListingPreviewFeesResponse,
	ListingResponse,
	ListingsListQuery,
	ListingsListResponse,
	ListingUpdate,
	ListingVerifyRequest,
	ListingVerifyResponse,
	ProductCompatibilityRequest,
	ProductCompatibilityResponse,
	SkuLocationsRequest,
	SkuLocationsResponse,
} from "@flipagent/types";
import type { Context } from "hono";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { withTradingAuth } from "../../middleware/with-trading-auth.js";
import { EbayApiError } from "../../services/ebay/rest/user-client.js";
import {
	deleteProductCompatibility,
	getProductCompatibility,
	setProductCompatibility,
} from "../../services/listings/compatibility.js";
import { createListing, MissingPrereqError, PublishFailedError } from "../../services/listings/create.js";
import { MissingSellerPoliciesError } from "../../services/listings/defaults.js";
import { createListingDraft } from "../../services/listings/draft.js";
import { getListing, listListings } from "../../services/listings/get.js";
import { publishByInventoryItemGroup, withdrawByInventoryItemGroup } from "../../services/listings/groups.js";
import { endListing, relistListing, updateListing } from "../../services/listings/lifecycle.js";
import { previewListingFees } from "../../services/listings/preview-fees.js";
import { deleteSkuLocations, getSkuLocations, setSkuLocations } from "../../services/listings/sku-locations.js";
import { verifyListing } from "../../services/listings/verify.js";
import { ebayMarketplaceId } from "../../services/shared/marketplace.js";
import { nextAction } from "../../services/shared/next-action.js";
import { errorResponse, jsonResponse, paramsFor, tbBody, tbCoerce } from "../../utils/openapi.js";

export const listingsRoute = new Hono();

const COMMON_RESPONSES = {
	401: errorResponse("API key missing or eBay account not connected (POST /v1/connect/ebay)."),
	412: errorResponse("Missing prerequisite — policies or merchant location not set."),
	502: errorResponse("Upstream eBay request failed."),
	503: errorResponse("This api instance does not have eBay configured."),
};

function mapEbayError(c: Context, err: unknown) {
	if (err instanceof MissingSellerPoliciesError) {
		return c.json(
			{
				error: "missing_seller_policies",
				message: err.message,
				missing: err.missing,
				next_action: nextAction(c, "setup_seller_policies"),
			},
			412,
		);
	}
	if (err instanceof MissingPrereqError) {
		return c.json({ error: err.code, message: err.message }, 412);
	}
	if (err instanceof PublishFailedError) {
		// Surface the upstream eBay error (errorId, longMessage, parameters)
		// so the agent can act on it. Without this the publish step looks
		// like a black box and the agent has nothing to surface to the user.
		const upstream = err.upstreamCause instanceof EbayApiError ? err.upstreamCause.upstream : undefined;
		return c.json({ error: "publish_failed", message: err.message, partial: err.partial, upstream }, 502);
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
		return c.json({ ...(await verifyListing(accessToken, body)) });
	}),
);

listingsRoute.post(
	"/draft",
	describeRoute({
		tags: ["Listings"],
		summary: "Create a listing draft on eBay (seller finishes via redirect)",
		description:
			"Wraps Sell Listing v1_beta `item_draft`. Returns `itemDraftId` + `listingRedirectUrl` so the seller can review + publish on ebay.com. Useful for `give me a one-click pre-filled listing` agent flows.",
		responses: {
			200: jsonResponse("Draft.", ListingDraftResponse),
			401: errorResponse("Auth missing."),
			502: errorResponse("Upstream eBay failed."),
		},
	}),
	requireApiKey,
	tbBody(ListingDraftRequest),
	async (c) => {
		const body = c.req.valid("json");
		const r = await createListingDraft(body, {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json({ ...r } satisfies ListingDraftResponse);
	},
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
				{ apiKeyId: c.var.apiKey.id, marketplace: ebayMarketplaceId() },
			);
			const filtered = query.status ? result.listings.filter((l) => l.status === query.status) : result.listings;
			const body: ListingsListResponse = {
				listings: filtered,
				limit: result.limit,
				offset: result.offset,
				...(result.total !== undefined ? { total: result.total } : {}),
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
				marketplace: ebayMarketplaceId(),
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
				marketplace: ebayMarketplaceId(),
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
				marketplace: ebayMarketplaceId(),
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
	"/groups/:groupKey/publish",
	describeRoute({
		tags: ["Listings"],
		summary: "Publish all variant offers under an inventory_item_group",
		description:
			"Wraps Sell Inventory `POST /offer/publish_by_inventory_item_group`. Publishes every offer attached to the named group on the named marketplace in one call — useful for multi-variation listings (size/color matrices) where individually-publishing each variant would race.",
		responses: {
			200: jsonResponse("Published.", ItemGroupPublishResponse),
			...COMMON_RESPONSES,
		},
	}),
	requireApiKey,
	tbBody(ItemGroupActionRequest),
	async (c) => {
		const body = c.req.valid("json");
		try {
			const result = await publishByInventoryItemGroup(body.inventoryItemGroupKey, body.marketplaceId, {
				apiKeyId: c.var.apiKey.id,
				marketplace: body.marketplaceId,
			});
			return c.json({ ...result });
		} catch (err) {
			const mapped = mapEbayError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);

listingsRoute.post(
	"/groups/:groupKey/withdraw",
	describeRoute({
		tags: ["Listings"],
		summary: "Withdraw all variant offers under an inventory_item_group",
		responses: {
			200: { description: "Withdrawn." },
			...COMMON_RESPONSES,
		},
	}),
	requireApiKey,
	tbBody(ItemGroupActionRequest),
	async (c) => {
		const body = c.req.valid("json");
		try {
			await withdrawByInventoryItemGroup(body.inventoryItemGroupKey, body.marketplaceId, {
				apiKeyId: c.var.apiKey.id,
				marketplace: body.marketplaceId,
			});
			return c.json({ ok: true });
		} catch (err) {
			const mapped = mapEbayError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);

listingsRoute.get(
	"/:sku/compatibility",
	describeRoute({
		tags: ["Listings"],
		summary: "Get product compatibility (parts/motors fitment)",
		responses: {
			200: jsonResponse("Compatibility list.", ProductCompatibilityResponse),
			404: errorResponse("No compatibility set."),
			...COMMON_RESPONSES,
		},
	}),
	requireApiKey,
	async (c) => {
		const sku = c.req.param("sku");
		try {
			const result = await getProductCompatibility(sku, { apiKeyId: c.var.apiKey.id });
			if (!result)
				return c.json({ error: "compatibility_not_set", message: `No compatibility for SKU '${sku}'.` }, 404);
			return c.json({ ...result });
		} catch (err) {
			const mapped = mapEbayError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);

listingsRoute.put(
	"/:sku/compatibility",
	describeRoute({
		tags: ["Listings"],
		summary: "Set product compatibility (parts/motors fitment list)",
		description:
			"Replaces the compatibility set for one inventory item. Each row lists property/value pairs (Year, Make, Model, ...) that describe one compatible product. Used by parts sellers — without compatibility, eBay's parts-finder can't surface the listing.",
		responses: {
			200: { description: "Set." },
			...COMMON_RESPONSES,
		},
	}),
	requireApiKey,
	tbBody(ProductCompatibilityRequest),
	async (c) => {
		const sku = c.req.param("sku");
		const body = c.req.valid("json");
		try {
			await setProductCompatibility(sku, body.compatibleProducts, { apiKeyId: c.var.apiKey.id });
			return c.json({ ok: true });
		} catch (err) {
			const mapped = mapEbayError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);

listingsRoute.delete(
	"/:sku/compatibility",
	describeRoute({
		tags: ["Listings"],
		summary: "Delete the product-compatibility set",
		responses: { 204: { description: "Deleted." }, ...COMMON_RESPONSES },
	}),
	requireApiKey,
	async (c) => {
		const sku = c.req.param("sku");
		try {
			await deleteProductCompatibility(sku, { apiKeyId: c.var.apiKey.id });
			return c.body(null, 204);
		} catch (err) {
			const mapped = mapEbayError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);

listingsRoute.get(
	"/:listingId/skus/:sku/locations",
	describeRoute({
		tags: ["Listings"],
		summary: "Get fulfillment-center mappings for one SKU within a listing",
		responses: {
			200: jsonResponse("Locations.", SkuLocationsResponse),
			404: errorResponse("No locations mapped."),
			...COMMON_RESPONSES,
		},
	}),
	requireApiKey,
	async (c) => {
		const { listingId, sku } = c.req.param();
		try {
			const r = await getSkuLocations(listingId, sku, { apiKeyId: c.var.apiKey.id });
			if (!r) return c.json({ error: "no_mappings", message: `No locations mapped for SKU '${sku}'.` }, 404);
			return c.json({ ...r });
		} catch (err) {
			const m = mapEbayError(c, err);
			if (m) return m;
			throw err;
		}
	},
);

listingsRoute.put(
	"/:listingId/skus/:sku/locations",
	describeRoute({
		tags: ["Listings"],
		summary: "Map fulfillment-center locations + per-location stock to one SKU",
		description:
			"Replaces the SKU's location set. Each entry pins a `merchantLocationKey` + per-location `quantity`. Used by sellers with multi-warehouse fulfillment so eBay calculates EDD per buyer location. Cap: first 50 locations are considered for EDD math.",
		responses: { 200: { description: "Mappings set." }, ...COMMON_RESPONSES },
	}),
	requireApiKey,
	tbBody(SkuLocationsRequest),
	async (c) => {
		const { listingId, sku } = c.req.param();
		const body = c.req.valid("json");
		try {
			await setSkuLocations(listingId, sku, body.locations, { apiKeyId: c.var.apiKey.id });
			return c.json({ ok: true });
		} catch (err) {
			const m = mapEbayError(c, err);
			if (m) return m;
			throw err;
		}
	},
);

listingsRoute.delete(
	"/:listingId/skus/:sku/locations",
	describeRoute({
		tags: ["Listings"],
		summary: "Clear all SKU→location mappings",
		responses: { 204: { description: "Cleared." }, ...COMMON_RESPONSES },
	}),
	requireApiKey,
	async (c) => {
		const { listingId, sku } = c.req.param();
		try {
			await deleteSkuLocations(listingId, sku, { apiKeyId: c.var.apiKey.id });
			return c.body(null, 204);
		} catch (err) {
			const m = mapEbayError(c, err);
			if (m) return m;
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
			return c.json({ ...result });
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
				marketplace: ebayMarketplaceId(),
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
