/**
 * Scrape backend for eBay-shape reads — Browse search/detail,
 * Marketplace Insights sold, Commerce Catalog. Returns the same
 * `BrowseSearchResponse` / `ItemDetail` / `CatalogProduct` shapes as
 * the REST transports so resource services don't care which transport
 * answered.
 *
 * Uses **only** the Oxylabs Web Scraper API: we POST a URL, they
 * return rendered HTML. Whatever rendering / IP rotation / JavaScript
 * execution Oxylabs does on their side is their product; we are just
 * an HTTPS client. flipagent's own code path runs no UA rotation
 * logic, no browser fingerprinting, and no scrape retry policies —
 * anything of that nature is on Oxylabs's infrastructure, under their
 * ToS with the upstream marketplace.
 *
 * Self-hosters who don't want this dependency can set
 * `EBAY_LISTINGS_SOURCE=bridge` (free, uses the user's extension) or
 * `EBAY_LISTINGS_SOURCE=rest` (Browse REST, 5000 calls/day quota).
 */

import {
	buildBrowseLayoutUrl,
	buildEbayUrl,
	type EbaySearchParams,
	parseEbayBrowseLayoutHtml,
	parseEbayDetailHtml,
	parseEbaySearchHtml,
	parseResultCount,
} from "@flipagent/ebay-scraper";
import type { BrowseSearchResponse, ItemDetail } from "@flipagent/types/ebay/buy";
import { JSDOM } from "jsdom";
import { ebayDetailToBrowse } from "./normalize.js";
import { fetchHtmlViaScraperApi } from "./scraper-api/index.js";

const domFactory = (html: string) => new JSDOM(html).window.document as unknown as ParentNode;

export interface ScrapeSearchInput {
	/**
	 * Keyword query. Optional when `categoryIds` is set — empty `q` +
	 * `categoryIds` triggers the browse-layout path
	 * (`/b/_/<categoryId>`), which is the canonical way to do
	 * category-only browse on the new (May 2026) eBay web layout. The
	 * old `/sch/<id>/i.html?_nkw=` route returns a results-less shell
	 * for empty keywords on the new layout.
	 */
	q?: string;
	soldOnly?: boolean;
	auctionOnly?: boolean;
	binOnly?: boolean;
	sort?: EbaySearchParams["sort"];
	/** Pipe-joined into eBay's `LH_ItemCondition`. Same numeric enum as Browse `conditionIds`. */
	conditionIds?: string[];
	limit?: number;
	/**
	 * Pagination offset, in *items*. Translates to eBay's per-page `_pgn`
	 * (eBay search-page renders ~60 cards per page) plus a client-side
	 * slice within the page. Capped at the same offset+limit ≤ 10000
	 * ceiling REST applies — eBay's web SRP technically goes further
	 * but we don't expose that since the REST mirror can't.
	 */
	offset?: number;
	/**
	 * Pipe-joined Browse category ids. Web SRP scopes by a single leaf
	 * category, so the first id wins; later ones are dropped (the demand-
	 * pulse archive still records the full list).
	 */
	categoryIds?: string;
	/**
	 * eBay-spec `aspect_filter` expression
	 * (`categoryId:N,Color:{Black|Red},Size:{8}`). Parsed into per-aspect
	 * URL params on the SRP — eBay's web search keys aspects by name
	 * (`Color`, `US Shoe Size`, …), so a clicked-facet URL drops in.
	 */
	aspectFilter?: string;
	/**
	 * UPC / EAN / ISBN. Folded into the keyword query (`_nkw=<q> <gtin>`)
	 * since web SRP has no dedicated GTIN axis. Best-effort: only listings
	 * whose seller put the GTIN in the title or aspects show up.
	 */
	gtin?: string;
}

/**
 * eBay web SRP page size: cards rendered per `_pgn` step.
 *
 * Live-verified 2026-05-05 against `/sch/i.html?LH_Sold=1` (see
 * `scripts/scrape-pagination-probe.ts`):
 *   - `_DEFAULT = 60`  — what eBay renders when `_ipg` is omitted
 *                         or set to an invalid value (`480`, etc.).
 *                         Modal page size; what `_pgn` advances by.
 *   - `_MAX     = 240` — largest `_ipg` eBay honors. One fetch yields
 *                         ~4× the data at the same Oxylabs cost
 *                         (~$0.005, ~6 s parse-clean). 120 also works
 *                         but is dominated by 240.
 *
 * `EBAY_SRP_PAGE_SIZE_DEFAULT` is also used as the fallback for
 * offset→page math on paths where we have not yet probed `_ipg`
 * support (browse-layout `/b/<slug>/<id>`, active-listings SRP).
 */
export const EBAY_SRP_PAGE_SIZE_DEFAULT = 60;
export const EBAY_SRP_PAGE_SIZE_MAX = 240;

/**
 * Hard ceiling on eBay pagination depth, in *items*. Same value
 * across REST (documented `offset+limit ≤ 10000`) and web SRP
 * (live-verified). Above this offset eBay clamps to the last valid
 * page and serves the same ids for every deeper request — looks like
 * a successful response, but every row is a duplicate of the prior
 * tail page. Callers paginating past this MUST dedupe by
 * `legacyItemId` to detect the wall, not rely on row count.
 *
 * With `_ipg=240`:
 *   - `_pgn` 1..30  → fresh 240 each (offset 0..6960)
 *   - `_pgn` 40..41 → fresh ~165 each (offset 9360..9600)
 *   - `_pgn` 42+    → clamped, repeats the same tail page
 *
 * So **per-query reachable unique items ≈ 9700**, regardless of how
 * many sold rows the `total` widget claims.
 */
export const EBAY_PAGINATION_OFFSET_CEILING = 10000;

/**
 * Deep-page ceiling for soldOnly searches at `_ipg=240`. The last
 * `_pgn` that returns fresh (non-clamped) data. Beyond this every
 * page is a duplicate of `_pgn=41`. Callers that loop pages
 * sequentially can stop here without paying for redundant fetches.
 *
 * Derivation: `floor(EBAY_PAGINATION_OFFSET_CEILING / EBAY_SRP_PAGE_SIZE_MAX) + 1 = 42`
 * but the 42nd page already starts repeating, so the practical
 * fresh-data wall is 41.
 */
export const EBAY_SRP_DEEP_PAGE_CEILING_AT_MAX_IPG = 41;

/**
 * Parse eBay's `aspect_filter` expression into the categoryId + per-
 * aspect dict the web-SRP URL builder consumes. Spec format
 * (https://developer.ebay.com/api-docs/buy/static/ref-buy-browse-filters.html):
 *
 *   `categoryId:<id>,Aspect1:{Value1|Value2},Aspect2:{Value}`
 *
 * The categoryId prefix is REQUIRED by eBay; if absent, we still emit
 * any aspect pairs we can parse (the SRP just won't have a category
 * scope and aspect facets may not narrow as expected — eBay's choice).
 *
 * Splitting top-level commas is safe — eBay's spec doesn't allow
 * commas inside aspect values, only pipes.
 */
export function parseAspectFilter(input: string): {
	categoryId?: string;
	aspects: Record<string, string>;
} {
	const aspects: Record<string, string> = {};
	let categoryId: string | undefined;
	for (const part of input.split(",")) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		if (trimmed.startsWith("categoryId:")) {
			categoryId = trimmed.slice("categoryId:".length);
			continue;
		}
		const m = trimmed.match(/^([^:]+):\{([^}]+)\}$/);
		if (m) {
			const [, name, values] = m;
			if (name && values) aspects[name] = values;
		}
	}
	return { categoryId, aspects };
}

export async function scrapeSearch(input: ScrapeSearchInput): Promise<BrowseSearchResponse> {
	const offset = Math.max(0, input.offset ?? 0);
	if (offset > EBAY_PAGINATION_OFFSET_CEILING) {
		// Match REST's behaviour: deep paging beyond 10K is not exposed.
		// Surface as an empty page rather than 4xx — the route layer
		// already handles the friendly framing.
		return input.soldOnly
			? { itemSales: [], total: 0, offset, limit: input.limit ?? 0 }
			: { itemSummaries: [], total: 0, offset, limit: input.limit ?? 0 };
	}

	// Category-only browse — no keyword, just a categoryId. Sourcing's
	// main flow. Resolves to `/b/<slug>/<categoryId>` whose hydration
	// JSON parses 1:1 to REST `item_summary/search` shape. Pagination,
	// sort, and condition / BIN-Auction filters all forward as URL
	// params on the same path.
	if ((!input.q || !input.q.trim()) && input.categoryIds && !input.soldOnly) {
		// `/b/<slug>/<id>/` is single-leaf-scoped on the web side, so
		// only the first id of a pipe-joined list wins. The remainder
		// is still recorded on the demand-pulse archive at the resource-
		// service layer.
		const [leafCategory, ...restCategories] = input.categoryIds.split("|");
		if (leafCategory) {
			const offset = Math.max(0, input.offset ?? 0);
			// Browse-layout `/b/...` `_ipg` support is not yet probed —
			// keep at the default 60.
			const page = Math.floor(offset / EBAY_SRP_PAGE_SIZE_DEFAULT) + 1;
			const sliceStart = offset % EBAY_SRP_PAGE_SIZE_DEFAULT;
			const url = buildBrowseLayoutUrl(leafCategory, {
				page,
				...(input.sort ? { sort: input.sort } : {}),
				...(input.binOnly ? { binOnly: input.binOnly } : {}),
				...(input.auctionOnly ? { auctionOnly: input.auctionOnly } : {}),
				...(input.conditionIds && input.conditionIds.length > 0 ? { conditionIds: input.conditionIds } : {}),
				...(restCategories[0] ? { subCategoryId: restCategories[0] } : {}),
			});
			const html = await fetchHtmlViaScraperApi(url);
			const items = parseEbayBrowseLayoutHtml(html);
			const sliced = items.slice(sliceStart, input.limit ? sliceStart + input.limit : undefined);
			return {
				itemSummaries: sliced,
				total: items.length,
				offset,
				limit: input.limit ?? sliced.length,
			};
		}
	}
	// Sold queries use `_ipg=240` — live-verified 4× more data per fetch
	// at the same Oxylabs cost. Active queries stick at the default 60
	// (untested at 240, and active SRP usage is interactive-browsing not
	// bulk capture). Update both branches at once if active is probed.
	const pageSize = input.soldOnly ? EBAY_SRP_PAGE_SIZE_MAX : EBAY_SRP_PAGE_SIZE_DEFAULT;
	const ebayPage = Math.floor(offset / pageSize) + 1;
	const sliceStart = offset % pageSize;
	// Translate eBay-spec mirror params to web-SRP equivalents.
	//   - `_dcat` (category) + `LH_*` (sold / BIN / auction / condition)
	//     are honoured by eBay's web SRP one-to-one.
	//   - `aspect_filter` is parsed and forwarded as `&AspectName=Value`
	//     URL params. Verified end-to-end against live eBay (May 2026):
	//     **the web SRP does NOT narrow on URL-based aspect params** —
	//     facets are applied JS-side via the sidebar checkbox state and
	//     AJAX-replaced result list. The URL `&AspectName=Value` keys
	//     eBay's UI emits are used only for chip rendering. We still
	//     forward (cost-free, audit-readable, future-proof if eBay
	//     consolidates URL+JS filtering) — but **for precise aspect
	//     narrowing, callers must use the REST source**, where
	//     `aspect_filter={Value}` narrows correctly.
	//   - `gtin` folds into the keyword query — best-effort, since web
	//     SRP has no dedicated GTIN axis.
	//   - `epid` / `fieldgroups` / `auto_correct` / `compatibility_filter`
	//     / `charity_ids` silently drop — no web-SRP equivalent.
	const aspect = input.aspectFilter ? parseAspectFilter(input.aspectFilter) : null;
	const categoryId = aspect?.categoryId ?? input.categoryIds?.split("|")[0] ?? undefined;
	const params: EbaySearchParams = {
		keyword: input.q ?? "",
		soldOnly: input.soldOnly,
		auctionOnly: input.auctionOnly,
		binOnly: input.binOnly,
		sort: input.sort,
		conditionIds: input.conditionIds,
		pages: 1,
		categoryId,
		aspectParams: aspect?.aspects,
		extraKeywords: input.gtin,
		...(input.soldOnly ? { itemsPerPage: EBAY_SRP_PAGE_SIZE_MAX as 240 } : {}),
	};
	const url = buildEbayUrl(params, ebayPage);
	const html = await fetchHtmlViaScraperApi(url);
	const items = parseEbaySearchHtml(html, params, domFactory);
	const total = parseResultCount(domFactory(html)) ?? items.length;
	// Slice within the fetched page first (offset within the page),
	// then cap at limit. When `limit` straddles the page boundary the
	// tail is silently dropped — matches REST behaviour where requesting
	// items past the end returns fewer than `limit`.
	const sliced = items.slice(sliceStart, input.limit ? sliceStart + input.limit : undefined);
	const envelope = { total, offset, limit: input.limit ?? sliced.length };
	return params.soldOnly ? { itemSales: sliced, ...envelope } : { itemSummaries: sliced, ...envelope };
}

export async function scrapeItemDetail(itemId: string, variationId?: string): Promise<ItemDetail | null> {
	// eBay's web /itm/ path uses the legacy numeric id, not the v1 envelope.
	// Strip `v1|<legacy>|<version>` → `<legacy>` so callers can pass either form.
	const legacyMatch = /^v1\|(\d+)\|\d+$/.exec(itemId);
	const legacyId = legacyMatch ? legacyMatch[1]! : itemId;
	// `?var=<n>` selects a specific variation on multi-SKU listings
	// (sneakers, clothes, bags). Without it eBay default-renders one
	// variation server-side — usually the cheapest — so the price + per-
	// variation aspects we extract would belong to the wrong SKU.
	const base = `https://www.ebay.com/itm/${encodeURIComponent(legacyId)}`;
	const url = variationId ? `${base}?var=${encodeURIComponent(variationId)}` : base;
	try {
		const html = await fetchHtmlViaScraperApi(url);
		const raw = parseEbayDetailHtml(html, url, domFactory);
		return ebayDetailToBrowse(raw, variationId);
	} catch {
		return null;
	}
}
