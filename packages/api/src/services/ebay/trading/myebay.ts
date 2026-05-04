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
	/** BidList only — the user's max proxy bid for this item, from
	 * `BiddingDetails.MaxBid`. The reconciler in `bridge-reconciler.ts`
	 * uses this as the oracle for whether a bridge-placed bid landed. */
	maxBidValue: string | null;
	maxBidCurrency: string | null;
	/** BidList only — `SellingStatus.HighBidder` (caller is winning). */
	highBidder: boolean | null;
	/** BidList only — total bids on the listing (`SellingStatus.BidCount`). */
	bidCount: number | null;
	/** WonList only — eBay's order line item id for this purchase
	 * (`OrderLineItemID`). Used by the purchase reconciler in
	 * `bridge-reconciler.ts` to detect "this exact purchase landed"
	 * (vs the user winning the same item again later). */
	orderLineItemId: string | null;
}

interface MyEbaySection {
	items: MyEbayItemRow[];
	total: number;
}

/** Trading XML wraps currency values as `{ '#text': <amount>, '@_currencyID': '<iso>' }`
 * (fast-xml-parser default text-node key is `#text`, not `_`). Returns
 * `{ value, currency }` as strings, or null if the field is absent. */
function moneyFrom(v: unknown): { value: string; currency: string } | null {
	if (!v || typeof v !== "object") return null;
	const obj = v as Record<string, unknown>;
	const value = obj["#text"];
	if (value == null) return null;
	const currency = obj["@_currencyID"];
	return {
		value: String(value),
		currency: typeof currency === "string" ? currency : "USD",
	};
}

/** Empty MyEbayItemRow shape — every section returns this; the
 * fields each section actually populates are documented on the
 * interface. */
function emptyRow(itemId: string): MyEbayItemRow {
	return {
		itemId,
		title: "",
		url: "",
		priceValue: null,
		priceCurrency: null,
		endDate: null,
		startDate: null,
		maxBidValue: null,
		maxBidCurrency: null,
		highBidder: null,
		bidCount: null,
		orderLineItemId: null,
	};
}

/** ActiveList / BidList / ScheduledList / UnsoldList — each `Item`
 * has price + listing details directly. BidList rows additionally
 * carry `BiddingDetails.MaxBid` and `SellingStatus.HighBidder`. */
function bidListRows(arr: Record<string, unknown> | undefined): MyEbayItemRow[] {
	if (!arr) return [];
	const list = arrayify(arr.Item);
	return list.map((row) => {
		const sellingStatus = (row.SellingStatus ?? {}) as Record<string, unknown>;
		const listing = (row.ListingDetails ?? {}) as Record<string, unknown>;
		const bidding = (row.BiddingDetails ?? {}) as Record<string, unknown>;
		const price = moneyFrom(sellingStatus.CurrentPrice ?? row.CurrentPrice ?? row.ConvertedCurrentPrice);
		const maxBid = moneyFrom(bidding.MaxBid);
		const bidCountRaw = stringFrom(sellingStatus.BidCount);
		return {
			...emptyRow(stringFrom(row.ItemID) ?? ""),
			title: stringFrom(row.Title) ?? "",
			url: stringFrom(listing.ViewItemURL) ?? "",
			priceValue: price?.value ?? null,
			priceCurrency: price?.currency ?? null,
			endDate: stringFrom(row.EndTime) ?? null,
			startDate: stringFrom(listing.StartTime) ?? null,
			maxBidValue: maxBid?.value ?? null,
			maxBidCurrency: maxBid?.currency ?? null,
			highBidder: detectHighBidder(sellingStatus.HighBidder),
			bidCount: bidCountRaw == null ? null : Number(bidCountRaw),
		};
	});
}

/** `SellingStatus.HighBidder` is a UserType object with a UserID
 * field. From OUR perspective: when we are the high bidder eBay
 * returns our unmasked UserID; when someone else is, eBay masks it
 * (e.g. "g***4"). Asterisk in the UserID = NOT us = we're outbid.
 * Absent HighBidder field → null (can't determine, treat as "not
 * yet known" rather than fabricating a value). */
function detectHighBidder(hb: unknown): boolean | null {
	if (hb == null) return null;
	if (typeof hb === "object") {
		const userId = stringFrom((hb as Record<string, unknown>).UserID);
		if (!userId) return null;
		return !userId.includes("*");
	}
	// Some Trading sections return HighBidder as a bare boolean
	// string ("true"/"false") — preserve that path for completeness.
	if (typeof hb === "string" || typeof hb === "boolean") return String(hb) === "true";
	return null;
}

/** WonList / LostList — `OrderTransactionArray.OrderTransaction[]`,
 * each carrying a `Transaction` with an embedded `Item`, plus
 * Transaction-level fields like `OrderLineItemID` and `TotalPrice`
 * that the purchase reconciler keys off of. The single-Transaction
 * case wraps as a non-array (fast-xml-parser collapses single
 * children) — `arrayify` handles both. */
function wonListRows(arr: Record<string, unknown> | undefined): MyEbayItemRow[] {
	if (!arr) return [];
	const list = arrayify(arr.OrderTransaction);
	const out: MyEbayItemRow[] = [];
	for (const wrap of list) {
		const transactions = arrayify(wrap.Transaction);
		for (const tx of transactions) {
			const item = (tx.Item ?? {}) as Record<string, unknown>;
			const itemId = stringFrom(item.ItemID) ?? "";
			if (!itemId) continue;
			const sellingStatus = (item.SellingStatus ?? {}) as Record<string, unknown>;
			const listing = (item.ListingDetails ?? {}) as Record<string, unknown>;
			// Prefer Transaction.TotalPrice (final paid amount including
			// shipping/fees) when available; fall back to the listing
			// price for older rows that don't carry TotalPrice yet.
			const price = moneyFrom(tx.TotalPrice) ?? moneyFrom(sellingStatus.CurrentPrice);
			out.push({
				...emptyRow(itemId),
				title: stringFrom(item.Title) ?? "",
				url: stringFrom(listing.ViewItemURL) ?? "",
				priceValue: price?.value ?? null,
				priceCurrency: price?.currency ?? null,
				endDate: stringFrom(item.EndTime) ?? null,
				startDate: stringFrom(listing.StartTime) ?? null,
				orderLineItemId: stringFrom(tx.OrderLineItemID) ?? null,
			});
		}
	}
	return out;
}

type SectionParser = (arr: Record<string, unknown> | undefined) => MyEbayItemRow[];

function sectionFrom(section: Record<string, unknown> | undefined, parser: SectionParser): MyEbaySection {
	if (!section) return { items: [], total: 0 };
	const arr = (section.ItemArray ?? section.OrderTransactionArray ?? section) as Record<string, unknown>;
	const items = parser(arr);
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
		active: sectionFrom(parsed.ActiveList as Record<string, unknown>, bidListRows),
		sold: sectionFrom(parsed.SoldList as Record<string, unknown>, wonListRows),
		unsold: sectionFrom(parsed.UnsoldList as Record<string, unknown>, bidListRows),
		scheduled: sectionFrom(parsed.ScheduledList as Record<string, unknown>, bidListRows),
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
		bidding: sectionFrom(parsed.BidList as Record<string, unknown>, bidListRows),
		watching: sectionFrom(parsed.WatchList as Record<string, unknown>, bidListRows),
		won: sectionFrom(parsed.WonList as Record<string, unknown>, wonListRows),
		lost: sectionFrom(parsed.LostList as Record<string, unknown>, wonListRows),
		bestOffers: sectionFrom(parsed.BestOfferList as Record<string, unknown>, bidListRows),
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
