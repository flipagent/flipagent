import {
	bidCeiling,
	categoryBeta,
	computeScore,
	DEFAULT_FEES,
	feeBreakdown,
	filterIqrOutliers,
	type MarketStats,
	optimalListPrice,
	percentile,
} from "../quant/index.js";
import { landedCost } from "../ship/landed-cost.js";
import { marketFromSold, toCents, toQuantListing } from "./adapter.js";
import type { EvaluableItem, EvaluateOptions, Evaluation, FiredSignal, NetRangeCents } from "./types.js";

const EMPTY_MARKET: MarketStats = {
	keyword: "",
	marketplace: "EBAY_US",
	windowDays: 0,
	meanCents: 0,
	stdDevCents: 0,
	medianCents: 0,
	p25Cents: 0,
	p75Cents: 0,
	nObservations: 0,
	salesPerDay: 0,
	asOf: new Date(0).toISOString(),
};

// Below this, percentile estimates are noise — IQR cleaning needs ≥4 anyway.
const MIN_SOLD_FOR_DISTRIBUTION = 4;

/**
 * Default outbound shipping when no forwarder leg supplied. $10 reflects
 * typical USPS Ground Advantage / Priority Mail for a 1-2lb US domestic
 * box. Cheap items will over-pay this estimate, heavy items will under-
 * pay; passing `opts.forwarder` swaps in the real landed-cost breakdown.
 * Caller can also override via `opts.outboundShippingCents` directly.
 */
const DEFAULT_OUTBOUND_SHIPPING_CENTS = 1000;

/**
 * Evaluate one listing against a sold pool and an optional forwarder leg.
 * Wraps `services/quant`'s `computeScore`, then attaches a landed-cost breakdown
 * when `opts.forwarder` is supplied.
 *
 * Without sold listings no margin signal is possible — the evaluation will be
 * `skip` with `netCents: 0`. Pass at least a handful.
 *
 * `bidCeilingCents` is derived from `recommendedExit.listPriceCents` —
 * the same competition-aware price the UI surfaces in "resell at $X in
 * ~Yd" — so the ceiling stays in lockstep with the realistic exit, not
 * a stale historical mean. Falls back to `market.meanCents` when the
 * hazard model can't run (no duration data, σ=0). `netRangeCents` still
 * uses the IQR-cleaned sold cohort directly — it's a descriptive p10/p90
 * band over historical net-per-sale, not a recommendation.
 */
export function evaluate(item: EvaluableItem, opts: EvaluateOptions = {}): Evaluation {
	const listing = toQuantListing(item);
	const market =
		opts.sold && opts.sold.length > 0 ? marketFromSold(opts.sold, undefined, undefined, opts.asks) : EMPTY_MARKET;

	let outboundShippingCents: number;
	let landedCostCents: number | null = null;
	if (opts.forwarder) {
		const breakdown = landedCost(item, opts.forwarder);
		landedCostCents = breakdown.totalCents;
		// The forwarder + tax leg is cost the *re-seller* pays after acquiring,
		// so it slots into outbound shipping for margin math.
		outboundShippingCents = breakdown.forwarderCents + breakdown.taxCents;
	} else if (opts.outboundShippingCents != null) {
		outboundShippingCents = opts.outboundShippingCents;
	} else {
		outboundShippingCents = DEFAULT_OUTBOUND_SHIPPING_CENTS;
	}

	const s = computeScore(listing, market, {
		expectedSaleMultiplier: opts.expectedSaleMultiplier,
		minNetCents: opts.minNetCents,
		minConfidence: opts.minConfidence,
		minSalesPerDay: opts.minSalesPerDay,
		outboundShippingCents,
	});

	const signals: FiredSignal[] = s.signals.map((sig) => ({
		name: sig.kind,
		weight: sig.strength,
		reason: sig.reason,
	}));

	const buyPriceCents = listing.priceCents + (listing.shippingCents ?? 0);
	const outbound = outboundShippingCents;

	let netRangeCents: NetRangeCents | null = null;
	if (opts.sold && opts.sold.length >= MIN_SOLD_FOR_DISTRIBUTION) {
		const soldPrices = opts.sold.map((s) => toCents(s.price?.value)).filter((p) => p > 0);
		const cleaned = filterIqrOutliers(soldPrices);
		if (cleaned.length >= MIN_SOLD_FOR_DISTRIBUTION) {
			const nets = cleaned.map((salePrice) => {
				const f = feeBreakdown(salePrice, DEFAULT_FEES);
				return salePrice - f.totalCents - buyPriceCents - outbound;
			});
			const p10 = percentile(nets, 0.1);
			const p90 = percentile(nets, 0.9);
			if (p10 !== null && p90 !== null) {
				netRangeCents = { p10Cents: p10, p90Cents: p90 };
			}
		}
	}

	// Recommended exit — runs the full hazard model + competition factor
	// + active-blend search to pick the price that maximises $/day. Then
	// subtract buy cost so the surfaced net is true flipping profit, not
	// gross sale-side net (which is what optimalListPrice returns natively).
	//
	// Exclude the candidate itself from the post-purchase competition
	// pool. If the user buys this listing, it leaves the active set —
	// they become the new seller, and their competition is everyone
	// else. Leaving the candidate in double-counts: the same listing
	// shows up as the buy target AND as a competitor in the resale
	// hazard model, biasing both `blendedCenter` and `competitionFactor`.
	// (The pre-purchase market summary at line above keeps the candidate
	// in — that's descriptive "what's the live market right now," not
	// post-purchase forecast.)
	const candidateId = item.itemId;
	const askPriceCents = (opts.asks ?? [])
		.filter((a) => a.itemId !== candidateId)
		.map((a) => toCents(a.price?.value))
		.filter((p) => p > 0);
	// EvaluableItem is the union of ItemSummary | ItemDetail; categoryId
	// only lives on the detail shape, so guard the access.
	const categoryId = "categoryId" in item ? item.categoryId : undefined;
	const beta = opts.beta ?? categoryBeta(categoryId);
	const advice = optimalListPrice(market, {
		fees: DEFAULT_FEES,
		outboundShippingCents: outbound,
		activeAskPrices: askPriceCents,
		// 6 months is the longest a reseller would realistically hold a
		// flip; without a cap, the high-β tail can produce multi-year
		// "least loss" picks that are mathematically optimal but useless
		// as a recommendation. User-supplied `maxDaysToSell` always wins.
		maxDaysToSell: opts.maxDaysToSell ?? 180,
		beta,
		// Rank candidate list prices by net-after-buy yield, not gross.
		// Without this, the ranker can recommend a fast-flipping cheap
		// price (high gross yield) even when every flip loses money.
		buyPriceCents,
	});
	// Surface the optimum exit whenever the model can run. The yield
	// ranking inside `optimalListPrice` accounts for buy cost, so the
	// recommended price is the best $/day for the reseller — positive
	// when a profitable flip exists, negative ("least-loss" frame) when
	// the buy price was above the achievable exit. The 180-day default
	// time cap keeps the search away from absurd "list for 5000 days"
	// extremes that arise at the high-β tail when no profitable price
	// exists; callers can override via `opts.maxDaysToSell`.
	let recommendedExit: Evaluation["recommendedExit"] = null;
	if (advice) {
		const flippingNetCents = advice.netCents - buyPriceCents;
		recommendedExit = {
			listPriceCents: advice.listPriceCents,
			expectedDaysToSell: advice.expectedDaysToSell,
			sellProb7d: advice.sellProb7d,
			sellProb14d: advice.sellProb14d,
			sellProb30d: advice.sellProb30d,
			netCents: flippingNetCents,
			dollarsPerDay: Math.round(flippingNetCents / Math.max(advice.expectedDaysToSell, 1)),
		};
	}

	// Bid ceiling derives from the SAME exit price the recommendation row
	// shows ("resell at $X in ~Yd"), not the naive sold mean. That price
	// already accounts for current competition (`blendedCenter`,
	// `competitionFactor`) and active-ask drift, so the buy ceiling stays
	// in lockstep with the realistic exit. Falls back to `market.meanCents`
	// when the hazard model can't run (no duration data, σ=0, no asks) so
	// callers without time-to-sell data still get a number.
	//
	// `opts.minNetCents ?? 0` — true break-even by default. Callers wanting
	// a profit floor pass `opts.minNetCents` explicitly (e.g. /v1/discover
	// passes 30 to filter for $30+ deals).
	const exitBasisCents = advice?.listPriceCents ?? market.meanCents;
	const bidCeilingCents =
		exitBasisCents > 0
			? bidCeiling(exitBasisCents, opts.minNetCents ?? 0, {
					fees: DEFAULT_FEES,
					outboundShippingCents: outbound,
				})
			: null;

	// Surface the cost components so the UI can render `$X = $sale −
	// $fees − $ship` without re-deriving constants. Only meaningful when
	// the bidCeiling itself is computable.
	const safeBidBreakdown =
		bidCeilingCents != null
			? {
					estimatedSaleCents: exitBasisCents,
					feesCents: feeBreakdown(exitBasisCents, DEFAULT_FEES).totalCents,
					shippingCents: outbound,
					targetNetCents: opts.minNetCents ?? 0,
				}
			: null;

	return {
		expectedNetCents: s.netCents,
		confidence: s.confidence,
		landedCostCents,
		signals,
		rating: s.rating,
		reason: s.reason,
		bidCeilingCents,
		safeBidBreakdown,
		netRangeCents,
		recommendedExit,
	};
}

// Re-exported so callers get cents-conversion without importing adapter.js directly.
export { toCents };
