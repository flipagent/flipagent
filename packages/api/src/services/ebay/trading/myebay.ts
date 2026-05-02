/**
 * Trading XML calls in the MyeBay namespace: selling + buying overview,
 * watch list, saved searches.
 *
 *   GetMyeBaySelling / GetMyeBayBuying — listings/orders for me
 *   AddToWatchList / RemoveFromWatchList — watch list mutations
 *   Saved-search list/add/delete (no clean Trading equivalents — see
 *   note inline)
 */

import { arrayify, escapeXml, parseTrading, stringFrom, tradingCall } from "./client.js";

export interface MyEbayItemRow {
	itemId: string;
	title: string;
	url: string;
	priceValue: string | null;
	priceCurrency: string | null;
	endDate: string | null;
	startDate: string | null;
}

interface MyEbaySection {
	items: MyEbayItemRow[];
	total: number;
}

function rowsFrom(arr: Record<string, unknown> | undefined): MyEbayItemRow[] {
	if (!arr) return [];
	const list = arrayify(arr.Item ?? arr.OrderTransactionArray ?? arr.Order);
	return list.map((row) => {
		const sellingStatus = (row.SellingStatus ?? {}) as Record<string, unknown>;
		const price = (sellingStatus.CurrentPrice ?? row.CurrentPrice ?? row.ConvertedCurrentPrice) as
			| { _: string; "@_currencyID": string }
			| undefined;
		const listing = (row.ListingDetails ?? {}) as Record<string, unknown>;
		return {
			itemId: stringFrom(row.ItemID) ?? "",
			title: stringFrom(row.Title) ?? "",
			url: stringFrom(listing.ViewItemURL) ?? "",
			priceValue: price?._ ?? null,
			priceCurrency: price?.["@_currencyID"] ?? null,
			endDate: stringFrom(row.EndTime) ?? null,
			startDate: stringFrom(listing.StartTime) ?? null,
		};
	});
}

function sectionFrom(section: Record<string, unknown> | undefined): MyEbaySection {
	if (!section) return { items: [], total: 0 };
	const items = rowsFrom((section.ItemArray ?? section.OrderTransactionArray ?? section) as Record<string, unknown>);
	const pagResult = (section.PaginationResult ?? {}) as Record<string, unknown>;
	const total = Number(stringFrom(pagResult.TotalNumberOfEntries) ?? items.length);
	return { items, total };
}

export async function getMyEbaySelling(
	accessToken: string,
): Promise<{ active: MyEbaySection; sold: MyEbaySection; unsold: MyEbaySection; scheduled: MyEbaySection }> {
	const body = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
	<DetailLevel>ReturnAll</DetailLevel>
	<ActiveList><Include>true</Include></ActiveList>
	<SoldList><Include>true</Include></SoldList>
	<UnsoldList><Include>true</Include></UnsoldList>
	<ScheduledList><Include>true</Include></ScheduledList>
</GetMyeBaySellingRequest>`;
	const xml = await tradingCall({ callName: "GetMyeBaySelling", accessToken, body });
	const parsed = parseTrading(xml, "GetMyeBaySelling");
	return {
		active: sectionFrom(parsed.ActiveList as Record<string, unknown>),
		sold: sectionFrom(parsed.SoldList as Record<string, unknown>),
		unsold: sectionFrom(parsed.UnsoldList as Record<string, unknown>),
		scheduled: sectionFrom(parsed.ScheduledList as Record<string, unknown>),
	};
}

export async function getMyEbayBuying(accessToken: string): Promise<{
	bidding: MyEbaySection;
	watching: MyEbaySection;
	won: MyEbaySection;
	lost: MyEbaySection;
	bestOffers: MyEbaySection;
}> {
	const body = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBayBuyingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
	<DetailLevel>ReturnAll</DetailLevel>
	<BidList><Include>true</Include></BidList>
	<WatchList><Include>true</Include></WatchList>
	<WonList><Include>true</Include></WonList>
	<LostList><Include>true</Include></LostList>
	<BestOfferList><Include>true</Include></BestOfferList>
</GetMyeBayBuyingRequest>`;
	const xml = await tradingCall({ callName: "GetMyeBayBuying", accessToken, body });
	const parsed = parseTrading(xml, "GetMyeBayBuying");
	return {
		bidding: sectionFrom(parsed.BidList as Record<string, unknown>),
		watching: sectionFrom(parsed.WatchList as Record<string, unknown>),
		won: sectionFrom(parsed.WonList as Record<string, unknown>),
		lost: sectionFrom(parsed.LostList as Record<string, unknown>),
		bestOffers: sectionFrom(parsed.BestOfferList as Record<string, unknown>),
	};
}

/* ----- watch list ---------------------------------------------------- */

export async function addToWatchList(accessToken: string, itemId: string): Promise<{ added: boolean }> {
	const body = `<?xml version="1.0" encoding="utf-8"?>
<AddToWatchListRequest xmlns="urn:ebay:apis:eBLBaseComponents">
	<ItemID>${escapeXml(itemId)}</ItemID>
</AddToWatchListRequest>`;
	const xml = await tradingCall({ callName: "AddToWatchList", accessToken, body });
	const parsed = parseTrading(xml, "AddToWatchList");
	return { added: stringFrom(parsed.Ack) === "Success" };
}

export async function removeFromWatchList(accessToken: string, itemId: string): Promise<{ removed: boolean }> {
	const body = `<?xml version="1.0" encoding="utf-8"?>
<RemoveFromWatchListRequest xmlns="urn:ebay:apis:eBLBaseComponents">
	<ItemID>${escapeXml(itemId)}</ItemID>
</RemoveFromWatchListRequest>`;
	const xml = await tradingCall({ callName: "RemoveFromWatchList", accessToken, body });
	const parsed = parseTrading(xml, "RemoveFromWatchList");
	return { removed: stringFrom(parsed.Ack) === "Success" };
}

/* ----- saved searches ------------------------------------------------ */
//
// eBay doesn't expose a clean "list saved searches" Trading call —
// `GetSearchResults` runs a saved search by id, and saved-search
// management is bundled under `GetMyMessages` notifications + the
// member-info system. The list/add/delete stubs below keep the
// surface well-typed; a real implementation will swap in a
// persistence store + bridge task to set up the subscription.

export async function listSavedSearches(accessToken: string): Promise<
	Array<{
		id: string;
		name: string;
		query: string;
		categoryId?: string;
		filter?: string;
		emailNotifications?: boolean;
		createdAt?: string;
	}>
> {
	const body = `<?xml version="1.0" encoding="utf-8"?>
<GetSearchResultsRequest xmlns="urn:ebay:apis:eBLBaseComponents">
	<DetailLevel>ReturnAll</DetailLevel>
</GetSearchResultsRequest>`;
	const _xml = await tradingCall({ callName: "GetSearchResults", accessToken, body }).catch(() => "");
	void _xml;
	return [];
}

export async function addSavedSearch(
	accessToken: string,
	args: { name: string; query?: string; categoryId?: string; filter?: string; emailNotifications?: boolean },
): Promise<{ id: string }> {
	void accessToken;
	void args;
	return { id: `saved-search-${Date.now()}` };
}

export async function deleteSavedSearch(accessToken: string, id: string): Promise<void> {
	void accessToken;
	void id;
}
