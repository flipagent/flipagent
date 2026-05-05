/**
 * commerce/catalog reads — universal product lookup by EPID + product
 * search. Three transports tried in order:
 *
 *   1. **REST via user OAuth** — when an api-key is bound to an eBay
 *      account. Verified live 2026-05-03: Catalog returns 200 with
 *      user OAuth + our default scopes, even though app-credential
 *      tokens are LR-gated. So any connected seller hits REST without
 *      us holding tenant approval. (NEW path 2026-05-03; previously
 *      the wrapper only attempted app-credential REST.)
 *   2. **REST via app credential** — only when `EBAY_CATALOG_APPROVED=1`
 *      (eBay-approved tenant). Lets anonymous-key paths skip scrape too.
 *   3. **scrape** — fuses /p/{epid} JSON-LD + listing item-specifics.
 *      Always available as the universal fallback.
 *
 * Service returns `FlipagentResult<T>` so the route renders
 * `X-Flipagent-Source` for callers that want to know which path served.
 */

import type { Marketplace, Product, ProductSearchQuery } from "@flipagent/types";
import { config, isEbayAppConfigured } from "../config.js";
import { appRequest } from "./ebay/rest/app-client.js";
import { sellRequest } from "./ebay/rest/user-client.js";
import { scrapeCatalogProduct } from "./ebay/scrape/catalog.js";
import { getFreshProduct, recordProductObservation } from "./observations.js";
import type { FlipagentResult } from "./shared/result.js";

/** Catalog products are stable; revalidate every 24h. */
const PRODUCT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Real eBay Catalog response shape (verified live 2026-05-03 against
 * `/commerce/catalog/v1_beta/product/4034210179` + spec at
 * `references/ebay-mcp/docs/_mirror/commerce_catalog_v1_beta_oas3.json`).
 * Field-name landmines:
 *   - **`gtin`/`ean`/`upc` are ARRAYS of strings** (spec field is
 *     singular `gtin`, but the value type is `string[]`). The previous
 *     wrapper named the field `gtins: string[]` — wrong name (was always
 *     undefined). Fixing the name back exposed the type: it IS an array,
 *     not a scalar — eBay returns multiple GTINs when the product has
 *     more than one packaging variant.
 *   - **`primaryCategoryId`** is a scalar string at the top level —
 *     NOT nested under `primaryCategory.categoryId` as the previous
 *     wrapper assumed.
 */
interface EbayProduct {
	epid: string;
	title?: string;
	description?: string;
	brand?: string;
	mpn?: string;
	gtin?: string[];
	ean?: string[];
	upc?: string[];
	image?: { imageUrl: string };
	additionalImages?: Array<{ imageUrl: string }>;
	aspects?: Array<{ localizedName: string; localizedValues: string[] }>;
	primaryCategoryId?: string;
	productWebUrl?: string;
}

export class ProductsError extends Error {
	readonly status: number;
	readonly code: string;
	constructor(code: string, status: number, message: string) {
		super(message);
		this.name = "ProductsError";
		this.code = code;
		this.status = status;
	}
}

export function ebayProductToProduct(p: EbayProduct, marketplace: Marketplace = "ebay_us"): Product {
	const images: string[] = [];
	if (p.image?.imageUrl) images.push(p.image.imageUrl);
	for (const i of p.additionalImages ?? []) if (i.imageUrl) images.push(i.imageUrl);
	const aspects: Record<string, string[]> = {};
	for (const a of p.aspects ?? []) aspects[a.localizedName] = a.localizedValues;
	return {
		epid: p.epid,
		marketplace,
		title: p.title ?? "",
		images,
		...(p.brand ? { brand: p.brand } : {}),
		...(p.mpn ? { mpn: p.mpn } : {}),
		// flipagent surface keeps `gtin` as a single string for ergonomics —
		// pick the first GTIN when multiple are returned, falling back to
		// EAN/UPC arrays when no GTIN is set.
		...(p.gtin?.[0] ? { gtin: p.gtin[0] } : p.ean?.[0] ? { gtin: p.ean[0] } : p.upc?.[0] ? { gtin: p.upc[0] } : {}),
		...(p.description ? { description: p.description } : {}),
		...(Object.keys(aspects).length ? { aspects } : {}),
		...(p.primaryCategoryId ? { category: { id: p.primaryCategoryId } } : {}),
	};
}

/**
 * Try Catalog REST in this order: user-OAuth → app-credential (when
 * approved) → null. Returns `null` when no REST transport produced a
 * response so the caller can fall through to scrape.
 *
 * `apiKeyId` is optional — when omitted (anonymous path), only app
 * credential is attempted.
 */
async function fetchCatalogRest<T = EbayProduct>(
	path: string,
	marketplace: string | undefined,
	apiKeyId: string | undefined,
): Promise<T | null> {
	if (apiKeyId) {
		try {
			return await sellRequest<T>({ apiKeyId, method: "GET", path, marketplace });
		} catch {
			// User OAuth refused (no eBay binding, scope dropped, etc.) —
			// try app credential next. Errors deliberately silenced; the
			// final fallback (scrape) ensures the caller still gets a
			// best-effort answer.
		}
	}
	if (config.EBAY_CATALOG_APPROVED && isEbayAppConfigured()) {
		try {
			return await appRequest<T>({ path, marketplace });
		} catch {
			// App credential refused too — fall through to scrape.
		}
	}
	return null;
}

export async function getProductByEpid(
	epid: string,
	marketplace?: string,
	apiKeyId?: string,
): Promise<FlipagentResult<Product> | null> {
	// Lake-as-cache: latest fresh `product_observations` row short-circuits
	// upstream. Same row that ML iteration reads from — single source of truth.
	const cached = await getFreshProduct(epid, PRODUCT_TTL_MS, marketplace ?? "ebay_us");
	if (cached) {
		return {
			body: cached.body,
			source: cached.source as "rest" | "scrape",
			fromCache: true,
			cachedAt: cached.observedAt,
		};
	}

	const restRes = await fetchCatalogRest(
		`/commerce/catalog/v1_beta/product/${encodeURIComponent(epid)}`,
		marketplace,
		apiKeyId,
	);
	if (restRes) {
		const body = ebayProductToProduct(restRes);
		void recordProductObservation(body, "rest", marketplace);
		return { body, source: "rest", fromCache: false };
	}

	const scraped = await scrapeCatalogProduct(epid).catch(() => null);
	if (!scraped) return null;
	const aspects: Record<string, string[]> = {};
	for (const a of scraped.aspects ?? []) {
		if (!a.localizedName) continue;
		aspects[a.localizedName] = a.localizedValues ?? [];
	}
	const images: string[] = [];
	const primaryUrl = typeof scraped.image === "string" ? scraped.image : scraped.image?.imageUrl;
	if (primaryUrl) images.push(primaryUrl);
	for (const i of scraped.additionalImages ?? []) {
		const url = typeof i === "string" ? i : i?.imageUrl;
		if (url) images.push(url);
	}
	const body: Product = {
		epid: scraped.epid ?? epid,
		marketplace: "ebay_us",
		title: scraped.title ?? "",
		images,
		...(scraped.brand ? { brand: scraped.brand } : {}),
		...(scraped.mpn?.[0] ? { mpn: scraped.mpn[0] } : {}),
		...(scraped.gtin?.[0] ? { gtin: scraped.gtin[0] } : {}),
		...(Object.keys(aspects).length ? { aspects } : {}),
		...(scraped.primaryCategoryId ? { category: { id: scraped.primaryCategoryId } } : {}),
	};
	void recordProductObservation(body, "scrape", marketplace ?? "ebay_us");
	return { body, source: "scrape", fromCache: false };
}

export interface ProductsSearchResult {
	products: Product[];
	limit: number;
	offset: number;
	total?: number;
}

/**
 * Product search has no scrape implementation — eBay only exposes
 * `/commerce/catalog/v1_beta/product_summary/search` via REST. With the
 * 2026-05-03 user-OAuth fallback, any connected seller can hit search
 * without `EBAY_CATALOG_APPROVED=1`. Anonymous-key paths still 503
 * unless the env flag is set.
 */
export async function searchProducts(
	q: ProductSearchQuery,
	apiKeyId?: string,
): Promise<FlipagentResult<ProductsSearchResult>> {
	const limit = q.limit ?? 50;
	const offset = q.offset ?? 0;
	const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
	if (q.q) params.set("q", q.q);
	if (q.gtin) params.set("gtin", q.gtin);
	if (q.mpn) params.set("mpn", q.mpn);
	if (q.brand) params.set("brand", q.brand);
	if (q.categoryId) params.set("category_ids", q.categoryId);
	const path = `/commerce/catalog/v1_beta/product_summary/search?${params.toString()}`;
	let res: { productSummaries?: EbayProduct[]; total?: number } | null = null;
	if (apiKeyId) {
		try {
			res = await sellRequest({ apiKeyId, method: "GET", path, marketplace: q.marketplace });
		} catch {
			// User OAuth refused — fall through to app credential.
		}
	}
	if (!res && config.EBAY_CATALOG_APPROVED && isEbayAppConfigured()) {
		res = await appRequest({ path, marketplace: q.marketplace });
	}
	if (!res) {
		throw new ProductsError(
			"catalog_search_rest_only",
			503,
			"Commerce Catalog search needs either an eBay-connected api key (user OAuth) or EBAY_CATALOG_APPROVED=1 + app credentials. Single-EPID lookup at /v1/products/{epid} also works through the scrape fallback.",
		);
	}
	return {
		body: {
			products: (res.productSummaries ?? []).map((p) => ebayProductToProduct(p, q.marketplace)),
			limit,
			offset,
			...(res.total !== undefined ? { total: res.total } : {}),
		},
		source: "rest",
		fromCache: false,
	};
}

interface EbayMetadataAspect {
	localizedAspectName?: string;
	aspectConstraint?: {
		aspectRequired?: boolean;
		aspectDataType?: string;
		itemToAspectCardinality?: string;
	};
	aspectValues?: Array<{ localizedValue: string }>;
}

function ebayMetadataAspectsToFlipagent(
	aspects: EbayMetadataAspect[] | undefined,
): Array<{ name: string; dataType?: string; required?: boolean; multiValued?: boolean; values?: string[] }> {
	return (aspects ?? []).map((a) => ({
		name: a.localizedAspectName ?? "",
		...(a.aspectConstraint?.aspectDataType ? { dataType: a.aspectConstraint.aspectDataType } : {}),
		required: !!a.aspectConstraint?.aspectRequired,
		multiValued: a.aspectConstraint?.itemToAspectCardinality === "MULTI",
		...(a.aspectValues?.length ? { values: a.aspectValues.map((v) => v.localizedValue) } : {}),
	}));
}

/**
 * Catalog `get_product_metadata` — required-/recommended-aspect names
 * and sample values for a given EPID (or category). Useful for filling
 * `aspects` correctly before listing.
 */
export async function getProductMetadata(
	q: { epid?: string; categoryId?: string; marketplace?: string },
	apiKeyId?: string,
): Promise<
	FlipagentResult<{
		epid?: string;
		categoryId?: string;
		aspects: ReturnType<typeof ebayMetadataAspectsToFlipagent>;
	}>
> {
	if (!q.epid && !q.categoryId) {
		throw new ProductsError("missing_epid_or_category", 400, "Provide ?epid= or ?categoryId=.");
	}
	const params = new URLSearchParams();
	if (q.epid) params.set("epid", q.epid);
	if (q.categoryId) params.set("category_id", q.categoryId);
	const path = `/commerce/catalog/v1_beta/get_product_metadata?${params.toString()}`;
	const res = await fetchCatalogRest<{ aspects?: EbayMetadataAspect[] }>(path, q.marketplace, apiKeyId);
	if (!res) {
		throw new ProductsError(
			"catalog_metadata_rest_only",
			503,
			"Commerce Catalog metadata needs an eBay-connected api key (user OAuth) or EBAY_CATALOG_APPROVED=1.",
		);
	}
	return {
		body: {
			...(q.epid ? { epid: q.epid } : {}),
			...(q.categoryId ? { categoryId: q.categoryId } : {}),
			aspects: ebayMetadataAspectsToFlipagent(res.aspects),
		},
		source: "rest",
		fromCache: false,
	};
}

/**
 * Catalog `get_product_metadata_for_categories` — bulk variant. Same
 * shape per category, multiple categories in one call.
 */
export async function getProductMetadataForCategories(
	q: { categoryIds: string; marketplace?: string },
	apiKeyId?: string,
): Promise<
	FlipagentResult<{
		entries: Array<{ categoryId: string; aspects: ReturnType<typeof ebayMetadataAspectsToFlipagent> }>;
	}>
> {
	const params = new URLSearchParams({ category_ids: q.categoryIds });
	const path = `/commerce/catalog/v1_beta/get_product_metadata_for_categories?${params.toString()}`;
	const res = await fetchCatalogRest<{
		categoryAspects?: Array<{ categoryId: string; aspects?: EbayMetadataAspect[] }>;
	}>(path, q.marketplace, apiKeyId);
	if (!res) {
		throw new ProductsError(
			"catalog_metadata_rest_only",
			503,
			"Commerce Catalog metadata needs an eBay-connected api key (user OAuth) or EBAY_CATALOG_APPROVED=1.",
		);
	}
	return {
		body: {
			entries: (res.categoryAspects ?? []).map((row) => ({
				categoryId: row.categoryId,
				aspects: ebayMetadataAspectsToFlipagent(row.aspects),
			})),
		},
		source: "rest",
		fromCache: false,
	};
}
