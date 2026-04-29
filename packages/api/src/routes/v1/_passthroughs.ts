/**
 * Builder for the "thin catch-all passthrough route" pattern. Each new
 * eBay resource we mirror gets a one-line declaration here instead of
 * a per-resource file with boilerplate. Reserve standalone files
 * (`sell-inventory.ts`, `sell-fulfillment.ts`, `sell-finances.ts`,
 * `sell-account.ts`, `sell-marketing.ts`, `sell-negotiation.ts`,
 * `post-order.ts`) for resources where we want explicit per-endpoint
 * docs or per-endpoint middleware. Everything else lives here.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { type CacheFirstOpts, cacheFirst } from "../../middleware/cache-first.js";
import { ebayPassthroughApp, ebayPassthroughUser } from "../../services/ebay/rest/client.js";
import { errorResponse } from "../../utils/openapi.js";

const passthroughResponses = {
	200: { description: "Forwarded from api.ebay.com." },
	401: errorResponse("API key missing or eBay account not connected (POST /v1/connect/ebay)."),
	502: errorResponse("Upstream eBay request failed."),
	503: errorResponse("EBAY_CLIENT_ID/SECRET/RU_NAME unset on this api instance."),
};

interface PassthroughDef {
	summary: string;
	description: string;
	/** `user` (default) requires the connected eBay refresh token; `app` uses flipagent's app credential. */
	auth?: "user" | "app";
	/**
	 * Optional cache-first wrapper for read-heavy near-static
	 * resources. Only applies to GET requests; POST/PUT/etc bypass.
	 * Use for Commerce Catalog (EPID lookup), Sell Metadata
	 * (per-marketplace policies that change rarely), etc.
	 */
	cache?: CacheFirstOpts;
}

export function makePassthroughRoute(def: PassthroughDef): Hono {
	const route = new Hono();
	const handler = def.auth === "app" ? ebayPassthroughApp : ebayPassthroughUser;
	const middlewares = def.cache ? [cacheFirst(def.cache), handler] : [handler];
	route.all(
		"/*",
		describeRoute({
			tags: ["eBay-compat"],
			summary: def.summary,
			description: def.description,
			responses: passthroughResponses,
		}),
		...middlewares,
	);
	return route;
}

export const ebaySellAnalyticsRoute = makePassthroughRoute({
	summary: "Sell Analytics — seller traffic + performance metrics",
	description:
		"Catch-all mirror of /sell/analytics/v1/*. Endpoints: customer_service_metric, traffic_report, seller_standards_profile. See https://developer.ebay.com/api-docs/sell/analytics/overview.html.",
});

export const ebaySellComplianceRoute = makePassthroughRoute({
	summary: "Sell Compliance — listing violation tracker",
	description:
		"Catch-all mirror of /sell/compliance/v1/*. Endpoints: listing_violation, listing_violation_summary. See https://developer.ebay.com/api-docs/sell/compliance/overview.html.",
});

export const ebaySellRecommendationRoute = makePassthroughRoute({
	summary: "Sell Recommendation — listing optimization tips",
	description:
		"Catch-all mirror of /sell/recommendation/v1/*. Endpoints: find_listing_recommendations. See https://developer.ebay.com/api-docs/sell/recommendation/overview.html.",
});

export const ebaySellLogisticsRoute = makePassthroughRoute({
	summary: "Sell Logistics — eBay-issued shipping labels (US, Limited Release)",
	description:
		"Catch-all mirror of /sell/logistics/v1_beta/*. Endpoints: shipping_quote, shipment, …. See https://developer.ebay.com/api-docs/sell/logistics/overview.html.",
});

export const ebaySellStoresRoute = makePassthroughRoute({
	summary: "Sell Stores — eBay Stores configuration",
	description:
		"Catch-all mirror of /sell/stores/v2/*. Endpoints: store-categories. See https://developer.ebay.com/api-docs/sell/stores/overview.html.",
});

export const ebaySellFeedRoute = makePassthroughRoute({
	summary: "Sell Feed — bulk listing upload",
	description:
		"Catch-all mirror of /sell/feed/v1/*. Endpoints: customer_service_metric_task, inventory_task, listing, order, schedule, task. See https://developer.ebay.com/api-docs/sell/feed/overview.html.",
});

export const ebayBuyFeedRoute = makePassthroughRoute({
	summary: "Buy Feed — bulk catalog feed (Limited Release)",
	description:
		"Catch-all mirror of /buy/feed/v1_beta/*. Endpoints: item, item_group, item_priority_descriptor, item_snapshot. See https://developer.ebay.com/api-docs/buy/feed/overview.html.",
	auth: "app",
});

export const ebayBuyDealRoute = makePassthroughRoute({
	summary: "Buy Deal — daily deals + Events listings",
	description:
		"Catch-all mirror of /buy/deal/v1/*. Endpoints: deal_item, event, event_item. See https://developer.ebay.com/api-docs/buy/deal/overview.html.",
	auth: "app",
});

export const ebayBuyOfferRoute = makePassthroughRoute({
	summary: "Buy Offer — buyer-side Best Offer send (queues, extension may execute)",
	description:
		"Catch-all mirror of /buy/offer/v1/*. Endpoints: bidding (auction), proxy_bidding. See https://developer.ebay.com/api-docs/buy/offer/overview.html.",
});

export const ebayCommerceIdentityRoute = makePassthroughRoute({
	summary: "Commerce Identity — connected user info",
	description:
		"Catch-all mirror of /commerce/identity/v1/*. Endpoints: user. See https://developer.ebay.com/api-docs/commerce/identity/overview.html.",
});

export const ebaySellMetadataRoute = makePassthroughRoute({
	summary: "Sell Metadata — return windows / shipping options per marketplace",
	description:
		"Catch-all mirror of /sell/metadata/v1/*. Endpoints: marketplace, return_policies, sales_tax_jurisdictions. Cache-first: per-marketplace policies change rarely so each unique read is cached for 7 days. See https://developer.ebay.com/api-docs/sell/metadata/overview.html.",
	cache: { scope: "sell-metadata", ttlSeconds: 7 * 24 * 60 * 60 },
});

export const ebayCommerceCatalogRoute = makePassthroughRoute({
	summary: "Commerce Catalog — eBay product catalog (epid lookup)",
	description:
		"Catch-all mirror of /commerce/catalog/v1_beta/*. Endpoints: product, product_summary. Cache-first: EPIDs are immutable so we serve from `proxy_response_cache` for 90 days after the first live fetch. See https://developer.ebay.com/api-docs/commerce/catalog/overview.html.",
	auth: "app",
	cache: { scope: "catalog", ttlSeconds: 90 * 24 * 60 * 60 },
});

export const ebayCommerceTranslationRoute = makePassthroughRoute({
	summary: "Commerce Translation — listing/title translation",
	description:
		"Catch-all mirror of /commerce/translation/v1/*. Endpoints: translate. See https://developer.ebay.com/api-docs/commerce/translation/overview.html.",
	auth: "app",
});
