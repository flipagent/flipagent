/**
 * Bridge backbone for the `ebay_query` task. flipagent API queues a
 * purchase order with `source=ebay_data`; the extension picks it up,
 * opens the relevant eBay public page in a hidden background tab,
 * lets the renderer process load it like any normal navigation, then
 * asks the content script — which has full DOM + DOMParser — to
 * extract the structured payload.
 *
 * Why a hidden tab and not a service-worker fetch:
 *   - SW fetches surface as `Sec-Fetch-Mode: cors` to eBay, which
 *     returns a challenge page rather than the document HTML.
 *   - SW also lacks a reliable DOMParser across Chrome versions
 *     (only exposed since Chrome 124 in extension SW context).
 *   - A real navigation in the user's own browser uses the user's
 *     existing session — same cookies and same IP they'd have if
 *     they typed the URL into the address bar.
 *
 * Cost: a tab spin-up adds ~3-5s vs a direct fetch. Acceptable —
 * results are cached server-side so subsequent identical queries
 * skip this entirely.
 */

import type { EbaySearchParams } from "@flipagent/ebay-scraper";

interface SearchMetadata {
	kind: "search";
	query: { q: string; filter?: string; sort?: string; limit?: number };
}
interface DetailMetadata {
	kind: "detail";
	itemId: string;
}
interface SoldMetadata {
	kind: "sold";
	query: { q: string; filter?: string; limit?: number };
}
type EbayQueryMetadata = SearchMetadata | DetailMetadata | SoldMetadata;

const TAB_LOAD_TIMEOUT_MS = 20_000;
const TAB_RENDER_DELAY_MS = 1500;
const DEFAULT_LIMIT = 25;

export async function runEbayQuery(metadata: unknown): Promise<unknown> {
	const meta = metadata as EbayQueryMetadata;
	if (meta.kind === "search") return doSearch(meta, false);
	if (meta.kind === "sold") return doSearch(meta as unknown as SearchMetadata, true);
	if (meta.kind === "detail") return doDetail(meta);
	throw new Error(`unknown ebay_query kind: ${(meta as { kind?: string }).kind}`);
}

async function doSearch(meta: SearchMetadata, soldOnly: boolean): Promise<unknown> {
	const params = mapToScraperParams(meta.query, soldOnly);
	const url = buildEbaySearchUrl(params);
	console.log("[ebay-query] search", { url, soldOnly });
	return extractInTab(url, { type: "flipagent:ebay-extract", kind: soldOnly ? "sold" : "search", params });
}

async function doDetail(meta: DetailMetadata): Promise<unknown> {
	const url = `https://www.ebay.com/itm/${encodeURIComponent(meta.itemId)}`;
	console.log("[ebay-query] detail", { url });
	return extractInTab(url, { type: "flipagent:ebay-extract", kind: "detail" });
}

async function extractInTab(url: string, message: Record<string, unknown>): Promise<unknown> {
	const tab = await chrome.tabs.create({ url, active: false });
	const tabId = tab.id;
	if (typeof tabId !== "number") throw new Error("tab create returned no id");
	console.log("[ebay-query] opened hidden tab", tabId);
	try {
		await waitForTabComplete(tabId, TAB_LOAD_TIMEOUT_MS);
		// Let post-load JS settle (price cells, dynamic counts).
		await new Promise((r) => setTimeout(r, TAB_RENDER_DELAY_MS));
		const reply = await chrome.tabs.sendMessage(tabId, message);
		if (!reply) throw new Error("content_script_no_reply");
		if ((reply as { error?: string }).error) {
			throw new Error(`content_script_error: ${(reply as { error?: string }).error}`);
		}
		return reply;
	} finally {
		await chrome.tabs.remove(tabId).catch(() => {});
	}
}

function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			chrome.tabs.onUpdated.removeListener(listener);
			reject(new Error(`tab ${tabId} load timeout after ${timeoutMs}ms`));
		}, timeoutMs);
		const listener = (changedId: number, info: chrome.tabs.TabChangeInfo) => {
			if (changedId === tabId && info.status === "complete") {
				clearTimeout(timer);
				chrome.tabs.onUpdated.removeListener(listener);
				resolve();
			}
		};
		chrome.tabs.onUpdated.addListener(listener);
	});
}

function buildEbaySearchUrl(params: EbaySearchParams): string {
	const u = new URL("https://www.ebay.com/sch/i.html");
	u.searchParams.set("_nkw", params.keyword);
	u.searchParams.set("_sacat", "0");
	u.searchParams.set("_pgn", "1");
	if (params.soldOnly) {
		u.searchParams.set("LH_Sold", "1");
		u.searchParams.set("LH_Complete", "1");
	}
	if (params.auctionOnly) u.searchParams.set("LH_Auction", "1");
	if (params.binOnly) u.searchParams.set("LH_BIN", "1");
	if (params.sort) {
		const sortMap: Record<string, string> = {
			endingSoonest: "1",
			newlyListed: "10",
			pricePlusShippingLowest: "15",
			pricePlusShippingHighest: "16",
		};
		const code = sortMap[params.sort];
		if (code) u.searchParams.set("_sop", code);
	}
	return u.toString();
}

function mapToScraperParams(
	query: { q: string; filter?: string; sort?: string; limit?: number },
	soldOnly: boolean,
): EbaySearchParams {
	const auctionOnly = query.filter?.includes("buyingOptions:{AUCTION}") ?? false;
	const binOnly = query.filter?.includes("buyingOptions:{FIXED_PRICE}") ?? false;
	const limit = query.limit ?? DEFAULT_LIMIT;
	const pages = Math.max(1, Math.ceil(limit / 60));
	return {
		keyword: query.q,
		soldOnly,
		auctionOnly,
		binOnly,
		sort: mapSort(query.sort),
		pages,
	};
}

function mapSort(sort: string | undefined): EbaySearchParams["sort"] {
	if (!sort) return undefined;
	if (sort === "endingSoonest") return "endingSoonest";
	if (sort === "newlyListed") return "newlyListed";
	if (sort === "price asc") return "pricePlusShippingLowest";
	if (sort === "price desc") return "pricePlusShippingHighest";
	return undefined;
}
