import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { optimalListPrice } from "../quant/index.js";
import { marketFromComps } from "./adapter.js";
import type { ResearchThesis } from "./types.js";

export interface ResearchThesisContext {
	keyword?: string;
	marketplace?: string;
	windowDays?: number;
}

/**
 * Build a market thesis: distribution stats from sold comps (+ optional
 * active asks), plus the EV-optimal list price when comps carry duration
 * data. The single bundle the agent passes to `/v1/draft`, `/v1/reprice`,
 * and `/v1/discover` to avoid re-fetching comps for every call.
 *
 * Returns `listPriceAdvice: null` when the market has no `meanDaysToSell`
 * (no time-to-sell observations among the comps).
 */
export function thesis(
	comps: ReadonlyArray<ItemSummary>,
	asks: ReadonlyArray<ItemSummary> | undefined,
	context: ResearchThesisContext = {},
): ResearchThesis {
	const market = marketFromComps(comps, context, undefined, asks);
	const listPriceAdvice = optimalListPrice(market);
	return { market, listPriceAdvice };
}
