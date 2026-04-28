import type { ItemDetail, ItemSummary } from "@flipagent/types/ebay/buy";
import { type MarketStats, optimalListPrice } from "../quant/index.js";
import type { DraftRecommendation } from "./types.js";

export interface DraftOptions {
	/** Outbound shipping (forwarder → buyer) cents. Default 0 — buyer pays. */
	outboundShippingCents?: number;
}

/**
 * Recommend an optimal listing for an item the seller is about to (re)list.
 * Wraps `optimalListPrice` and passes the input title through verbatim
 * (a future title rewriter slots in here).
 *
 * `listPriceAdvice` is null when the market lacks `meanDaysToSell` — caller
 * should fall back to listing at `market.medianCents` manually.
 */
export function draft(
	item: ItemSummary | ItemDetail,
	market: MarketStats,
	opts: DraftOptions = {},
): DraftRecommendation {
	const advice = optimalListPrice(market, {
		outboundShippingCents: opts.outboundShippingCents,
	});
	const titleSuggestion = item.title ?? "";
	let reason: string;
	if (!advice) {
		if (!market.meanDaysToSell || market.meanDaysToSell <= 0) {
			reason = `no time-to-sell data among ${market.nObservations} comps — list at $${(market.medianCents / 100).toFixed(2)} manually`;
		} else if (market.meanCents <= 0) {
			reason = "market mean is zero — no comps to anchor price";
		} else {
			reason = "no candidate price cleared the yield optimum";
		}
	} else {
		reason = `list at $${(advice.listPriceCents / 100).toFixed(2)} for max yield (~${advice.expectedDaysToSell.toFixed(1)}d expected, ${Math.round(advice.sellProb14d * 100)}% sell-by-14d)`;
	}
	return { titleSuggestion, listPriceAdvice: advice, reason };
}
