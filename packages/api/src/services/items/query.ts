/**
 * `ItemSearchQuery` (flipagent shape) → eBay-filter strings the existing
 * `services/search.ts` dispatcher consumes. Cents → dollars conversion
 * happens here too, so the dispatcher itself stays unchanged.
 */

import type { ItemSearchQuery } from "@flipagent/types";

interface MappedSearch {
	q: string;
	limit?: number;
	offset?: number;
	filter?: string;
	sort?: string;
	categoryIds?: string;
	aspectFilter?: string;
	fieldgroups?: string;
	autoCorrect?: string;
	compatibilityFilter?: string;
	charityIds?: string;
}

const SORT_MAP: Record<NonNullable<ItemSearchQuery["sort"]>, string | undefined> = {
	relevance: undefined,
	price_asc: "price",
	price_desc: "-price",
	newest: "newlyListed",
	ending_soonest: "endingSoonest",
};

function centsToDollars(cents: number): string {
	return (cents / 100).toFixed(2);
}

/**
 * Compose eBay's `filter=` parameter from flipagent fields. Each clause
 * joined by comma, multi-value clauses joined by pipe inside braces.
 *
 *   conditionIds=[1000,3000]     → "conditionIds:{1000|3000}"
 *   priceMin=1000, priceMax=5000 → "price:[10.00..50.00],priceCurrency:USD"
 *   buyingOption="auction"       → "buyingOptions:{AUCTION}"
 */
function buildFilter(q: ItemSearchQuery): string | undefined {
	const clauses: string[] = [];
	if (q.conditionIds && q.conditionIds.length > 0) {
		clauses.push(`conditionIds:{${q.conditionIds.join("|")}}`);
	}
	if (q.priceMin !== undefined || q.priceMax !== undefined) {
		const lo = q.priceMin !== undefined ? centsToDollars(q.priceMin) : "";
		const hi = q.priceMax !== undefined ? centsToDollars(q.priceMax) : "";
		clauses.push(`price:[${lo}..${hi}]`);
		clauses.push("priceCurrency:USD");
	}
	if (q.buyingOption) {
		const upper = q.buyingOption.toUpperCase();
		clauses.push(`buyingOptions:{${upper}}`);
	}
	return clauses.length > 0 ? clauses.join(",") : undefined;
}

export function mapItemSearchQuery(q: ItemSearchQuery): MappedSearch {
	const structured = buildFilter(q);
	const filter = q.filter && structured ? `${structured},${q.filter}` : (q.filter ?? structured);
	return {
		q: q.q ?? "",
		limit: q.limit,
		offset: q.offset,
		filter,
		sort: q.sort ? SORT_MAP[q.sort] : undefined,
		categoryIds: q.categoryId,
		aspectFilter: q.aspectFilter,
		fieldgroups: q.fieldgroups,
		autoCorrect: q.autoCorrect,
		compatibilityFilter: q.compatibilityFilter,
		charityIds: q.charityIds,
	};
}

/** Map flipagent `country` → eBay `X-EBAY-C-MARKETPLACE-ID` header. */
const MARKETPLACE_BY_COUNTRY: Record<string, string> = {
	US: "EBAY_US",
	GB: "EBAY_GB",
	DE: "EBAY_DE",
	AU: "EBAY_AU",
	CA: "EBAY_CA",
	FR: "EBAY_FR",
	IT: "EBAY_IT",
	ES: "EBAY_ES",
	JP: "EBAY_JP",
	HK: "EBAY_HK",
};

export function ebayMarketplaceForCountry(country: string | undefined): string | undefined {
	if (!country) return undefined;
	return MARKETPLACE_BY_COUNTRY[country.toUpperCase()];
}
