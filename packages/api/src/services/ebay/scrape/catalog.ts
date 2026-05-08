/**
 * Commerce Catalog API parity via scrape. eBay's Catalog REST is
 * Limited Release — most apps (including ours, today) get
 * `Insufficient permissions` from `/commerce/catalog/v1_beta/...` even
 * with valid app credentials. This module reproduces the documented
 * `Product` shape (https://developer.ebay.com/api-docs/commerce/catalog
 * /types/catal:Product) by fusing two scrape sources:
 *
 *   1. `ebay.com/p/{epid}` — JSON-LD `Product` schema.org block gives
 *      canonical title, brand, model, gtin13, and the master image set.
 *   2. The metadata-richest active listing under that EPID — its
 *      item-specifics dl rows give the structured `aspects` array
 *      (localizedName / localizedValues), and the listing breadcrumb
 *      gives the leaf `primaryCategoryId`.
 *
 * Strict 1:1 with eBay's documented `Product` type — only fields that
 * appear in eBay's schema are emitted. Fields eBay always populates but
 * we cannot scrape (`description`, `version`) are omitted; eBay also
 * makes them optional, so omission is schema-conformant. Sibling-EPID
 * data the page exposes (the "Compare similar products" links) is NOT
 * emitted here because eBay's `Product` type has no field for it; if
 * we surface it later it goes through a separate flipagent-native
 * endpoint, never this catalog mirror.
 */

import { extractEbayDetail } from "@flipagent/ebay-scraper";
import type {
	CatalogAspect,
	CatalogAspectDistribution,
	CatalogAspectValueDistribution,
	CatalogImage,
	CatalogProduct,
	CatalogProductSearchResponse,
	CatalogProductSummary,
	CatalogRefinement,
	CatalogSearchQuery,
} from "@flipagent/types/ebay/commerce";
import { JSDOM } from "jsdom";
import { config } from "../../../config.js";
import { fetchHtmlViaScraperApi } from "./scraper-api/index.js";
import { sprdCatalogProduct, sprdCatalogSearch } from "./scraper-api/sprd.js";

const domFactory = (html: string) => new JSDOM(html).window.document;

interface LdProduct {
	name?: string;
	url?: string;
	image?: string[];
	brand?: string | { name?: string };
	model?: string;
	gtin13?: string;
	gtin12?: string;
	gtin8?: string;
	mpn?: string;
}

function findLdProduct(doc: Document): LdProduct | null {
	const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
	for (const s of Array.from(scripts)) {
		const text = s.textContent ?? "";
		try {
			const obj = JSON.parse(text) as Record<string, unknown>;
			const candidates: unknown[] = [obj];
			if (obj && typeof obj === "object") {
				const main = (obj as { mainEntity?: Record<string, unknown> }).mainEntity;
				if (main) candidates.push(main);
				const offers = main && (main as { offers?: { itemOffered?: unknown[] } }).offers;
				if (offers && Array.isArray(offers.itemOffered)) candidates.push(...offers.itemOffered);
			}
			for (const c of candidates) {
				if (c && typeof c === "object" && (c as { "@type"?: string })["@type"] === "Product") {
					return c as LdProduct;
				}
			}
		} catch {}
	}
	return null;
}

/** GTIN/EAN/UPC are the same number in different forms.
 *  GTIN-13 == EAN-13 == UPC-12 zero-padded. eBay listings often only
 *  surface a UPC aspect; map to gtin/ean/upc top-level arrays so the
 *  response carries every form catalog clients may match against. */
function deriveIdentifiers(gtinLike: string | undefined): { gtin?: string; ean?: string; upc?: string } {
	if (!gtinLike) return {};
	const digits = gtinLike.replace(/\D/g, "");
	if (digits.length === 12) {
		const gtin13 = `0${digits}`;
		return { gtin: gtin13, ean: gtin13, upc: digits };
	}
	if (digits.length === 13) {
		const upc = digits.startsWith("0") ? digits.slice(1) : undefined;
		return { gtin: digits, ean: digits, upc };
	}
	return { gtin: digits };
}

function dedupeImages(urls: ReadonlyArray<string>): CatalogImage[] {
	const seen = new Set<string>();
	const out: CatalogImage[] = [];
	for (const raw of urls) {
		if (!raw) continue;
		const key = raw.match(/\/g\/[A-Za-z0-9~]+\//)?.[0] ?? raw;
		if (seen.has(key)) continue;
		seen.add(key);
		// Normalise to the s-l1600 high-res variant so the response
		// matches Catalog REST's `imageUrl` resolution (1600px).
		const normalised = raw.replace(/s-l\d+\.(jpg|webp|png)/i, "s-l1600.$1");
		out.push({ imageUrl: normalised });
	}
	return out;
}

/** Pull a representative `iid` from /p/'s JSON-LD `offers` so we know
 *  which listing to scrape for item-specifics. */
function pickRepresentativeListingId(html: string): string | null {
	const ids = [...html.matchAll(/[?&]iid=(\d{9,})/g)].map((m) => m[1]).filter((v): v is string => Boolean(v));
	return ids[0] ?? null;
}

/** Top-level entry: produce a Catalog `Product` for the given EPID by
 *  scraping `ebay.com/p/{epid}` plus a representative listing under
 *  that EPID. Returns null when /p/ is not found (404). */
export async function scrapeCatalogProduct(epid: string): Promise<CatalogProduct | null> {
	if (config.SCRAPER_API_VENDOR === "sprd") return sprdCatalogProduct(epid);
	const productUrl = `https://www.ebay.com/p/${encodeURIComponent(epid)}`;
	let productHtml: string;
	try {
		productHtml = await fetchHtmlViaScraperApi(productUrl);
	} catch {
		return null;
	}
	const productDoc = domFactory(productHtml);
	const ld = findLdProduct(productDoc);
	if (!ld) return null;

	const repId = pickRepresentativeListingId(productHtml);
	let aspects: CatalogAspect[] = [];
	let primaryCategoryId: string | undefined;
	if (repId) {
		const itmUrl = `https://www.ebay.com/itm/${repId}`;
		try {
			const itmHtml = await fetchHtmlViaScraperApi(itmUrl);
			const itmDoc = domFactory(itmHtml);
			const detail = extractEbayDetail(itmDoc, itmUrl, itmHtml);
			aspects = (detail.aspects ?? []).map<CatalogAspect>((a) => ({
				localizedName: a.name,
				localizedValues: /,\s/.test(a.value) ? a.value.split(/,\s+/).map((v) => v.trim()) : [a.value],
			}));
			// Last entry of the breadcrumb chain is the leaf category —
			// eBay's Catalog REST `primaryCategoryId` semantics.
			primaryCategoryId = detail.categoryIds.at(-1) ?? undefined;
		} catch {}
	}

	const aspectMap = new Map<string, string[]>();
	for (const a of aspects) {
		if (a.localizedName && a.localizedValues) aspectMap.set(a.localizedName, a.localizedValues);
	}
	const upcAspect = aspectMap.get("UPC")?.[0];
	const eanAspect = aspectMap.get("EAN")?.[0];
	const isbnAspect = aspectMap.get("ISBN")?.[0];
	const mpnAspect = aspectMap.get("MPN")?.[0] ?? aspectMap.get("Reference Number")?.[0];
	const brandAspect = aspectMap.get("Brand")?.[0];
	const modelAspect = aspectMap.get("Model")?.[0];

	const gtinSeed = ld.gtin13 ?? ld.gtin12 ?? upcAspect ?? eanAspect;
	const ids = deriveIdentifiers(gtinSeed);

	const images = dedupeImages(ld.image ?? []);
	const ldBrand = typeof ld.brand === "string" ? ld.brand : ld.brand?.name;

	const product: CatalogProduct = {
		additionalImages: images.slice(1),
		aspects: aspects.length > 0 ? aspects : undefined,
		brand: ldBrand ?? brandAspect,
		ean: ids.ean ? [ids.ean] : undefined,
		epid,
		gtin: ids.gtin ? [ids.gtin] : undefined,
		image: images[0],
		isbn: isbnAspect ? [isbnAspect] : undefined,
		mpn: mpnAspect ? [mpnAspect] : modelAspect ? [modelAspect] : undefined,
		primaryCategoryId,
		productWebUrl: ld.url ?? productUrl,
		title: ld.name,
		upc: ids.upc ? [ids.upc] : undefined,
	};

	// Strip optional fields whose value is empty so the wire response
	// matches eBay's "omit when absent" convention exactly.
	const out: CatalogProduct = { epid };
	for (const [k, v] of Object.entries(product)) {
		if (v === undefined) continue;
		if (Array.isArray(v) && v.length === 0) continue;
		(out as Record<string, unknown>)[k] = v;
	}
	return out;
}

// ────────────────────────────────────────────────────────────────────
// product_summary/search
// ────────────────────────────────────────────────────────────────────

/** Hard cap on per-EPID hydration. Matches eBay REST's default
 *  `limit=50`. Each result triggers a page fetch on the scrape path
 *  so a full-50 cold call takes ~30–60s; the resource service caches
 *  the full response so subsequent identical queries return instantly. */
const SCRAPE_HYDRATION_CAP = 50;

const FIELDGROUP_RE = /\b(MATCHING_PRODUCTS|ASPECT_REFINEMENTS|FULL)\b/g;

function parseFieldgroups(raw: string | undefined): Set<string> {
	const out = new Set<string>();
	if (!raw) return out;
	for (const m of raw.matchAll(FIELDGROUP_RE)) out.add(m[1] ?? "");
	return out;
}

function buildSearchUrl(q: CatalogSearchQuery): string {
	// eBay's catalog REST accepts q / gtin / mpn / category_ids /
	// aspect_filter. The buyer-facing equivalent is /sch/i.html which
	// supports `_nkw` (query) and routes raw GTINs through the same
	// endpoint. category_ids → `_sacat`. aspect_filter is not directly
	// translatable to /sch/ refinements; ignored for now.
	const url = new URL("https://www.ebay.com/sch/i.html");
	const term = q.q ?? q.gtin ?? q.mpn ?? "";
	if (term) url.searchParams.set("_nkw", term);
	if (q.category_ids) url.searchParams.set("_sacat", q.category_ids.split(",")[0] ?? "");
	return url.toString();
}

/** Pull all unique catalog EPIDs from a /sch/ HTML page in document
 *  order. eBay surfaces matched catalog products as `/p/{epid}` anchors
 *  (sometimes inline carousel cards, sometimes inside listing cards
 *  that map back to a catalog product). */
function harvestEpidsFromSearch(html: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const m of html.matchAll(/\/p\/(\d{6,})/g)) {
		const epid = m[1];
		if (!epid || seen.has(epid)) continue;
		seen.add(epid);
		out.push(epid);
	}
	return out;
}

/** Convert a `Product` to its `ProductSummary` projection. Drops
 *  `description`, `primaryCategoryId`, `otherApplicableCategoryIds`,
 *  `version` (Product-only fields) and adds `productHref` (URI back
 *  to getProduct), exactly as eBay does between the two types. */
function projectSummary(product: CatalogProduct): CatalogProductSummary {
	const summary: CatalogProductSummary = {
		additionalImages: product.additionalImages,
		aspects: product.aspects,
		brand: product.brand,
		ean: product.ean,
		epid: product.epid,
		gtin: product.gtin,
		image: product.image,
		isbn: product.isbn,
		mpn: product.mpn,
		productHref: product.epid ? `https://api.ebay.com/commerce/catalog/v1_beta/product/${product.epid}` : undefined,
		productWebUrl: product.productWebUrl,
		title: product.title,
		upc: product.upc,
	};
	const out: CatalogProductSummary = {};
	for (const [k, v] of Object.entries(summary)) {
		if (v === undefined) continue;
		if (Array.isArray(v) && v.length === 0) continue;
		(out as Record<string, unknown>)[k] = v;
	}
	return out;
}

/** Aggregate aspect distributions across the hydrated summaries.
 *  eBay's `Refinement` is a histogram: per aspect name, per value, the
 *  number of matching products that carry that value. We compute it
 *  from the aspects we already scraped, so building the histogram
 *  costs zero extra fetches.
 *
 *  `dominantCategoryId` is the most frequent leaf category across the
 *  hydrated set — same definition eBay uses ("most likely to cover the
 *  matching products"). */
function buildRefinement(products: ReadonlyArray<CatalogProduct>, searchTerm: string): CatalogRefinement {
	const aspectCounts = new Map<string, Map<string, number>>();
	const categoryCounts = new Map<string, number>();
	for (const p of products) {
		if (p.primaryCategoryId) {
			categoryCounts.set(p.primaryCategoryId, (categoryCounts.get(p.primaryCategoryId) ?? 0) + 1);
		}
		for (const a of p.aspects ?? []) {
			if (!a.localizedName) continue;
			const valueMap = aspectCounts.get(a.localizedName) ?? new Map<string, number>();
			for (const v of a.localizedValues ?? []) valueMap.set(v, (valueMap.get(v) ?? 0) + 1);
			aspectCounts.set(a.localizedName, valueMap);
		}
	}
	const dominantCategoryId = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

	const aspectDistributions: CatalogAspectDistribution[] = [];
	for (const [name, valueMap] of aspectCounts) {
		const aspectValueDistributions: CatalogAspectValueDistribution[] = [...valueMap.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([value, count]) => ({
				localizedAspectValue: value,
				matchCount: count,
				refinementHref:
					`https://api.ebay.com/commerce/catalog/v1_beta/product_summary/search?q=${encodeURIComponent(searchTerm)}` +
					`&aspect_filter=${encodeURIComponent(`${name}:{${value}}`)}`,
			}));
		aspectDistributions.push({ localizedAspectName: name, aspectValueDistributions });
	}

	const refinement: CatalogRefinement = {};
	if (dominantCategoryId) refinement.dominantCategoryId = dominantCategoryId;
	if (aspectDistributions.length > 0) refinement.aspectDistributions = aspectDistributions;
	return refinement;
}

/** Top-level entry: produce a `ProductSearchResponse` for the given
 *  query by scraping eBay's search results page, harvesting the
 *  `/p/{epid}` matches, hydrating each via `scrapeCatalogProduct`,
 *  and projecting to `ProductSummary`. When `fieldgroups` includes
 *  `ASPECT_REFINEMENTS` or `FULL`, also computes the `refinement`
 *  histogram from the hydrated set (no extra fetches).
 *
 *  Cost: 1 search-page fetch + N hydration fetches in parallel. N is
 *  clamped to `SCRAPE_HYDRATION_CAP` (20) so a single search call
 *  stays under ~30 seconds even on the cold path. eBay REST defaults
 *  to limit=50 — with REST that's free; on scrape we trade some 1:1
 *  fidelity at the page-size frontier for predictable latency. */
export async function scrapeCatalogSearch(query: CatalogSearchQuery): Promise<CatalogProductSearchResponse> {
	if (config.SCRAPER_API_VENDOR === "sprd") return sprdCatalogSearch(query);
	const limit = Math.min(query.limit ?? 50, SCRAPE_HYDRATION_CAP);
	const offset = query.offset ?? 0;
	const searchUrl = buildSearchUrl(query);

	let searchHtml: string;
	try {
		searchHtml = await fetchHtmlViaScraperApi(searchUrl);
	} catch {
		return { limit, offset, productSummaries: [] };
	}

	const allEpids = harvestEpidsFromSearch(searchHtml);
	const slice = allEpids.slice(offset, offset + limit);

	const hydrated = await Promise.all(slice.map((epid) => scrapeCatalogProduct(epid).catch(() => null)));
	const products = hydrated.filter((p): p is CatalogProduct => p != null);

	const summaries = products.map(projectSummary);
	const groups = parseFieldgroups(query.fieldgroups);
	const wantRefinement = groups.has("ASPECT_REFINEMENTS") || groups.has("FULL");

	const response: CatalogProductSearchResponse = {
		limit,
		offset,
		productSummaries: summaries,
	};
	if (wantRefinement) {
		const term = query.q ?? query.gtin ?? query.mpn ?? "";
		const refinement = buildRefinement(products, term);
		if (Object.keys(refinement).length > 0) response.refinement = refinement;
	}
	return response;
}
