import { type MarketStats, repriceAdvice } from "../quant/index.js";
import type { RepriceRecommendation, RepriceStateInput } from "./types.js";

/**
 * Decide hold/drop/delist for a sitting listing. Thin wrapper around
 * `quant.repriceAdvice` — the heuristic compares time elapsed since
 * listing against the market's expected time-to-sell. Defaults to
 * "hold" when no `meanDaysToSell` is available (no model, don't bluff).
 */
export function reprice(market: MarketStats, state: RepriceStateInput): RepriceRecommendation {
	const advice = repriceAdvice(market, {
		currentPriceCents: state.currentPriceCents,
		listedAt: state.listedAt,
	});
	return {
		action: advice.action,
		daysListed: advice.daysListed,
		suggestedPriceCents: advice.suggestedPriceCents,
		reason: advice.reason,
	};
}
