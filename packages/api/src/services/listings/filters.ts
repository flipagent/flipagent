/**
 * Browse `filter` expression helpers. Used by the listings services to
 * translate the eBay-shape filter string into the pieces the scrape
 * path needs.
 */

/**
 * Pull the conditionIds list out of a Browse filter expression
 * (`...,conditionIds:{1000|3000},...`). Returns undefined when the
 * filter is missing or carries no conditionIds.
 */
export function parseConditionIdsFilter(filter: string | undefined): string[] | undefined {
	if (!filter) return undefined;
	const m = filter.match(/conditionIds:\{([^}]+)\}/);
	if (!m) return undefined;
	const ids = m[1]!
		.split("|")
		.map((s) => s.trim())
		.filter(Boolean);
	return ids.length > 0 ? ids : undefined;
}

export function filterIncludesAuctionOnly(filter: string | undefined): boolean {
	return filter?.includes("buyingOptions:{AUCTION}") ?? false;
}

export function filterIncludesBinOnly(filter: string | undefined): boolean {
	return filter?.includes("buyingOptions:{FIXED_PRICE}") ?? false;
}
