import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { marketFromComparables } from "../evaluate/adapter.js";
import type { MarketSummary } from "../evaluate/types.js";
import { optimalListPrice } from "../quant/index.js";

export interface MarketSummaryContext {
	keyword?: string;
	marketplace?: string;
	windowDays?: number;
}

/**
 * Build a market summary: distribution stats from sold comparables (+ optional
 * active asks), plus the EV-optimal list price when comparables carry duration
 * data. The single bundle the agent passes to `/v1/draft`, `/v1/reprice`,
 * and `/v1/discover` to avoid re-fetching comparables for every call.
 *
 * Returns `listPriceRecommendation: null` when the market has no `meanDaysToSell`
 * (no time-to-sell observations among the comparables).
 */
export function marketSummary(
	comparables: ReadonlyArray<ItemSummary>,
	asks: ReadonlyArray<ItemSummary> | undefined,
	context: MarketSummaryContext = {},
): MarketSummary {
	const market = marketFromComparables(comparables, context, undefined, asks);
	const listPriceRecommendation = optimalListPrice(market);
	return { market, listPriceRecommendation };
}
