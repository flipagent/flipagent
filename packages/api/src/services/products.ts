/**
 * commerce/catalog reads — universal product lookup by EPID + product
 * search. Transport pluggable per `markets.catalog` in
 * `services/shared/transport.ts`:
 *
 *   - REST: Limited Release; gated by `EBAY_CATALOG_APPROVED`
 *   - scrape: fuses /p/{epid} JSON-LD + listing item-specifics
 *
 * `selectTransport` decides which to use; the service wraps the
 * picked transport's response in `FlipagentResult<T>` so the route
 * can render `X-Flipagent-Source`. Search has no scrape implementation,
 * so a missing REST capability surfaces as `TransportUnavailableError`.
 */

import type { Marketplace, Product, ProductSearchQuery } from "@flipagent/types";
import { config, isEbayAppConfigured } from "../config.js";
import { appRequest } from "./ebay/rest/app-client.js";
import { scrapeCatalogProduct } from "./ebay/scrape/catalog.js";
import type { FlipagentResult } from "./shared/result.js";
import { selectTransport, TransportUnavailableError } from "./shared/transport.js";

interface EbayProduct {
	epid: string;
	title?: string;
	description?: string;
	brand?: string;
	mpn?: string;
	gtins?: string[];
	image?: { imageUrl: string };
	additionalImages?: Array<{ imageUrl: string }>;
	aspects?: Array<{ localizedName: string; localizedValues: string[] }>;
	primaryCategory?: { categoryId: string; categoryName?: string };
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

export function ebayProductToProduct(p: EbayProduct, marketplace: Marketplace = "ebay"): Product {
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
		...(p.gtins?.[0] ? { gtin: p.gtins[0] } : {}),
		...(p.description ? { description: p.description } : {}),
		...(Object.keys(aspects).length ? { aspects } : {}),
		...(p.primaryCategory
			? {
					category: {
						id: p.primaryCategory.categoryId,
						...(p.primaryCategory.categoryName ? { name: p.primaryCategory.categoryName } : {}),
					},
				}
			: {}),
	};
}

function pickProductTransport(): "rest" | "scrape" {
	try {
		return selectTransport("markets.catalog", {
			appCredsConfigured: isEbayAppConfigured(),
			envFlags: { EBAY_CATALOG_APPROVED: config.EBAY_CATALOG_APPROVED },
		}) as "rest" | "scrape";
	} catch (err) {
		if (err instanceof TransportUnavailableError) {
			throw new ProductsError("catalog_unavailable", 503, err.message);
		}
		throw err;
	}
}

export async function getProductByEpid(epid: string, marketplace?: string): Promise<FlipagentResult<Product> | null> {
	const transport = pickProductTransport();

	if (transport === "rest") {
		try {
			const res = await appRequest<EbayProduct>({
				path: `/commerce/catalog/v1_beta/product/${encodeURIComponent(epid)}`,
				marketplace,
			});
			return { body: ebayProductToProduct(res), source: "rest", fromCache: false };
		} catch {
			// REST refused — fall through to scrape so callers always get
			// a best-effort answer when the env later loses approval.
		}
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
		marketplace: "ebay",
		title: scraped.title ?? "",
		images,
		...(scraped.brand ? { brand: scraped.brand } : {}),
		...(scraped.mpn?.[0] ? { mpn: scraped.mpn[0] } : {}),
		...(scraped.gtin?.[0] ? { gtin: scraped.gtin[0] } : {}),
		...(Object.keys(aspects).length ? { aspects } : {}),
		...(scraped.primaryCategoryId ? { category: { id: scraped.primaryCategoryId } } : {}),
	};
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
 * `/commerce/catalog/v1_beta/product_summary/search` via REST. When
 * `EBAY_CATALOG_APPROVED` is unset (or eBay revokes approval),
 * `selectTransport` returns "scrape" which we surface as 503 because
 * search-by-scrape isn't built.
 */
export async function searchProducts(q: ProductSearchQuery): Promise<FlipagentResult<ProductsSearchResult>> {
	const transport = pickProductTransport();
	if (transport !== "rest") {
		throw new ProductsError(
			"catalog_search_rest_only",
			503,
			"Commerce Catalog search requires EBAY_CATALOG_APPROVED=1 and configured eBay app credentials. Single-EPID lookup at /v1/products/{epid} works without REST via the scrape fallback.",
		);
	}

	const limit = q.limit ?? 50;
	const offset = q.offset ?? 0;
	const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
	if (q.q) params.set("q", q.q);
	if (q.gtin) params.set("gtin", q.gtin);
	if (q.mpn) params.set("mpn", q.mpn);
	if (q.brand) params.set("brand", q.brand);
	if (q.categoryId) params.set("category_ids", q.categoryId);
	const res = await appRequest<{ productSummaries?: EbayProduct[]; total?: number }>({
		path: `/commerce/catalog/v1_beta/product_summary/search?${params.toString()}`,
		marketplace: q.marketplace,
	});
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
