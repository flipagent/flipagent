/**
 * `/v1/me/{selling,buying}` — caller's seller-side & buyer-side overviews.
 * Wraps Trading XML `GetMyeBaySelling` / `GetMyeBayBuying` and converts
 * the eBay-shape rows into flipagent `Item`.
 */

import type { BuyingOverview, Item, SellingOverview } from "@flipagent/types";
import { getMyEbayBuying, getMyEbaySelling, type MyEbayItemRow } from "./ebay/trading/myebay.js";
import { toCents } from "./shared/money.js";

function rowToItem(row: MyEbayItemRow): Item {
	return {
		id: row.itemId,
		marketplace: "ebay",
		status: "active",
		title: row.title,
		url: row.url || `https://www.ebay.com/itm/${row.itemId}`,
		images: [],
		...(row.priceValue ? { price: { value: toCents(row.priceValue), currency: row.priceCurrency ?? "USD" } } : {}),
		...(row.endDate ? { endsAt: row.endDate } : {}),
		...(row.startDate ? { createdAt: row.startDate } : {}),
	};
}

export async function fetchSellingOverview(accessToken: string): Promise<SellingOverview> {
	const r = await getMyEbaySelling(accessToken);
	return {
		active: { items: r.active.items.map(rowToItem), total: r.active.total },
		sold: { items: r.sold.items.map((row) => ({ ...rowToItem(row), status: "sold" })), total: r.sold.total },
		unsold: { items: r.unsold.items.map((row) => ({ ...rowToItem(row), status: "ended" })), total: r.unsold.total },
		scheduled: { items: r.scheduled.items.map(rowToItem), total: r.scheduled.total },
	};
}

export async function fetchBuyingOverview(accessToken: string): Promise<BuyingOverview> {
	const r = await getMyEbayBuying(accessToken);
	return {
		bidding: { items: r.bidding.items.map(rowToItem), total: r.bidding.total },
		watching: { items: r.watching.items.map(rowToItem), total: r.watching.total },
		won: { items: r.won.items.map((row) => ({ ...rowToItem(row), status: "sold" })), total: r.won.total },
		lost: { items: r.lost.items.map((row) => ({ ...rowToItem(row), status: "ended" })), total: r.lost.total },
		bestOffers: { items: r.bestOffers.items.map(rowToItem), total: r.bestOffers.total },
	};
}

/** Re-export so `services/watching.ts` can derive watch items from the same Trading call without duplicating row→Item logic. */
export { rowToItem };
