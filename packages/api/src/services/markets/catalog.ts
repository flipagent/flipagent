/**
 * Commerce Catalog resource service. Picks transport (REST when
 * EBAY_CATALOG_APPROVED + app creds, scrape otherwise) and dispatches.
 * Returns the same `CatalogProduct` shape eBay's REST `getProduct`
 * documents — agents can swap `api.ebay.com` for `api.flipagent.dev`
 * without touching their parser.
 */

import type { CatalogProduct, CatalogProductSearchResponse, CatalogSearchQuery } from "@flipagent/types/ebay/commerce";
import { config, isEbayAppConfigured } from "../../config.js";
import { fetchRetry } from "../../utils/fetch-retry.js";
import { getAppAccessToken } from "../ebay/oauth.js";
import { scrapeCatalogProduct, scrapeCatalogSearch } from "../ebay/scrape/catalog.js";
import { hashQuery } from "../shared/cache.js";
import type { FlipagentResult } from "../shared/result.js";
import { selectTransport, type Transport, TransportUnavailableError } from "../shared/transport.js";
import { withCache } from "../shared/with-cache.js";

const PRODUCT_PATH = "/commerce/catalog/v1_beta/product";
const SEARCH_PATH = "/commerce/catalog/v1_beta/product_summary/search";
// Search results have a much shorter useful lifespan than getProduct
// (active listings churn) — 1h cache so a re-run within the hour
// returns instantly without re-paying the N+1 hydration cost.
const SEARCH_TTL_SEC = 60 * 60;
// EPIDs are immutable product-master ids — the catalog response only
// changes when eBay edits the product record (rare). 90 days mirrors
// the existing passthrough TTL.
const PRODUCT_TTL_SEC = 90 * 24 * 60 * 60;

export class CatalogError extends Error {
	readonly status: number;
	readonly code: string;
	constructor(code: string, status: number, message: string) {
		super(message);
		this.code = code;
		this.status = status;
		this.name = "CatalogError";
	}
}

export interface CatalogContext {
	explicit?: Transport;
	marketplace?: string;
}

export type CatalogProductResult = FlipagentResult<CatalogProduct>;

async function fetchCatalogProductRest(epid: string, marketplace: string): Promise<CatalogProduct | null> {
	let token: string;
	try {
		token = await getAppAccessToken();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new CatalogError("upstream_failed", 502, msg);
	}
	const url = `${config.EBAY_BASE_URL}${PRODUCT_PATH}/${encodeURIComponent(epid)}`;
	const upstream = await fetchRetry(url, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
			"X-EBAY-C-MARKETPLACE-ID": marketplace,
		},
	}).catch((err) => {
		const msg = err instanceof Error ? err.message : String(err);
		throw new CatalogError("upstream_failed", 502, msg);
	});
	if (upstream.status === 404) return null;
	const text = await upstream.text();
	if (!upstream.ok) {
		const status = upstream.status >= 500 ? 502 : upstream.status;
		throw new CatalogError("upstream_failed", status, `eBay ${upstream.status}: ${text.slice(0, 200)}`);
	}
	try {
		return JSON.parse(text) as CatalogProduct;
	} catch {
		throw new CatalogError("upstream_failed", 502, "eBay returned non-JSON catalog response");
	}
}

export async function getCatalogProduct(epid: string, ctx: CatalogContext = {}): Promise<CatalogProductResult | null> {
	let transport: Transport;
	try {
		transport = selectTransport("markets.catalog", {
			explicit: ctx.explicit,
			appCredsConfigured: isEbayAppConfigured(),
			envFlags: { EBAY_CATALOG_APPROVED: config.EBAY_CATALOG_APPROVED },
		});
	} catch (err) {
		if (err instanceof TransportUnavailableError) {
			throw new CatalogError("ebay_not_configured", 503, err.message);
		}
		throw err;
	}

	const marketplace = ctx.marketplace ?? "EBAY_US";
	const queryHash = hashQuery({ epid, marketplace, t: transport });
	let missing = false;
	const result = await withCache<CatalogProduct>(
		{ scope: `catalog:product:${transport}`, ttlSec: PRODUCT_TTL_SEC, path: PRODUCT_PATH, queryHash },
		async () => {
			if (transport === "rest") {
				const body = await fetchCatalogProductRest(epid, marketplace);
				if (!body) {
					missing = true;
					throw new MissingProduct();
				}
				return { body, source: "rest" };
			}
			const body = await scrapeCatalogProduct(epid);
			if (!body) {
				missing = true;
				throw new MissingProduct();
			}
			return { body, source: "scrape" };
		},
	).catch((err) => {
		if (err instanceof MissingProduct) return null;
		throw err;
	});

	if (missing || !result) return null;
	return result;
}

class MissingProduct extends Error {
	constructor() {
		super("missing_product");
		this.name = "MissingProduct";
	}
}

// ────────────────────────────────────────────────────────────────────
// product_summary/search
// ────────────────────────────────────────────────────────────────────

export type CatalogSearchResult = FlipagentResult<CatalogProductSearchResponse>;

async function fetchCatalogSearchRest(
	query: CatalogSearchQuery,
	marketplace: string,
): Promise<CatalogProductSearchResponse> {
	let token: string;
	try {
		token = await getAppAccessToken();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new CatalogError("upstream_failed", 502, msg);
	}
	const params = new URLSearchParams();
	if (query.q) params.set("q", query.q);
	if (query.gtin) params.set("gtin", query.gtin);
	if (query.mpn) params.set("mpn", query.mpn);
	if (query.category_ids) params.set("category_ids", query.category_ids);
	if (query.aspect_filter) params.set("aspect_filter", query.aspect_filter);
	if (query.fieldgroups) params.set("fieldgroups", query.fieldgroups);
	if (query.limit != null) params.set("limit", String(query.limit));
	if (query.offset != null) params.set("offset", String(query.offset));
	const url = `${config.EBAY_BASE_URL}${SEARCH_PATH}?${params}`;
	const upstream = await fetchRetry(url, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
			"X-EBAY-C-MARKETPLACE-ID": marketplace,
		},
	}).catch((err) => {
		const msg = err instanceof Error ? err.message : String(err);
		throw new CatalogError("upstream_failed", 502, msg);
	});
	const text = await upstream.text();
	if (!upstream.ok) {
		const status = upstream.status >= 500 ? 502 : upstream.status;
		throw new CatalogError("upstream_failed", status, `eBay ${upstream.status}: ${text.slice(0, 200)}`);
	}
	try {
		return JSON.parse(text) as CatalogProductSearchResponse;
	} catch {
		throw new CatalogError("upstream_failed", 502, "eBay returned non-JSON catalog search response");
	}
}

export async function searchCatalogProducts(
	query: CatalogSearchQuery,
	ctx: CatalogContext = {},
): Promise<CatalogSearchResult> {
	let transport: Transport;
	try {
		transport = selectTransport("markets.catalog", {
			explicit: ctx.explicit,
			appCredsConfigured: isEbayAppConfigured(),
			envFlags: { EBAY_CATALOG_APPROVED: config.EBAY_CATALOG_APPROVED },
		});
	} catch (err) {
		if (err instanceof TransportUnavailableError) {
			throw new CatalogError("ebay_not_configured", 503, err.message);
		}
		throw err;
	}

	const marketplace = ctx.marketplace ?? "EBAY_US";
	const queryHash = hashQuery({ ...query, marketplace, t: transport });
	return withCache<CatalogProductSearchResponse>(
		{ scope: `catalog:search:${transport}`, ttlSec: SEARCH_TTL_SEC, path: SEARCH_PATH, queryHash },
		async () => {
			if (transport === "rest") {
				return { body: await fetchCatalogSearchRest(query, marketplace), source: "rest" };
			}
			return { body: await scrapeCatalogSearch(query), source: "scrape" };
		},
	);
}
