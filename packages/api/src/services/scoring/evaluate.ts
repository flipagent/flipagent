import {
	bidCeiling,
	categoryBeta,
	DEFAULT_FEES,
	feeBreakdown,
	filterIqrOutliers,
	type MarketStats,
	optimalListPrice,
	percentile,
	score,
} from "../quant/index.js";
import { marketFromComps, toCents, toQuantListing } from "./adapter.js";
import { landedCost } from "./landed-cost.js";
import type { DealVerdict, EvaluateOptions, Listing, NetRangeCents, SignalHit } from "./types.js";

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
const MIN_COMPS_FOR_DISTRIBUTION = 4;

/**
 * Default outbound shipping when no forwarder leg supplied. $10 reflects
 * typical USPS Ground Advantage / Priority Mail for a 1-2lb US domestic
 * box. Cheap items will over-pay this estimate, heavy items will under-
 * pay; passing `opts.forwarder` swaps in the real landed-cost breakdown.
 * Caller can also override via `opts.outboundShippingCents` directly.
 */
const DEFAULT_OUTBOUND_SHIPPING_CENTS = 1000;

/**
 * Evaluate one listing against sold comparables and an optional forwarder leg.
 * Wraps `services/quant`'s `score`, then attaches a landed-cost breakdown
 * when `opts.forwarder` is supplied.
 *
 * Without `comps` no margin signal is possible — the verdict will be `skip`
 * with `netCents: 0`. Pass at least a handful of sold listings.
 *
 * `bidCeilingCents`, `probProfit`, and `netRangeCents` are derived from the
 * same IQR-cleaned cohort the mean uses, so an agent that filters by
 * `probProfit > 0.75 && netCents > X` sees a consistent view.
 */
export function evaluate(item: Listing, opts: EvaluateOptions = {}): DealVerdict {
	const listing = toQuantListing(item);
	const market =
		opts.comps && opts.comps.length > 0
			? marketFromComps(opts.comps, undefined, undefined, opts.asks)
			: EMPTY_MARKET;

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

	const s = score(listing, market, {
		saleMultiplier: opts.saleMultiplier,
		minNetCents: opts.minNetCents,
		minConfidence: opts.minConfidence,
		minSalesPerDay: opts.minSalesPerDay,
		outboundShippingCents,
	});

	const signals: SignalHit[] = s.signals.map((sig) => ({
		name: sig.kind,
		weight: sig.strength,
		reason: sig.reason,
	}));

	const buyPriceCents = listing.priceCents + (listing.shippingCents ?? 0);
	const outbound = outboundShippingCents;

	let netRangeCents: NetRangeCents | null = null;
	let probProfit: number | null = null;
	if (opts.comps && opts.comps.length >= MIN_COMPS_FOR_DISTRIBUTION) {
		const compPrices = opts.comps.map((c) => toCents(c.price?.value)).filter((p) => p > 0);
		const cleaned = filterIqrOutliers(compPrices);
		if (cleaned.length >= MIN_COMPS_FOR_DISTRIBUTION) {
			const nets = cleaned.map((salePrice) => {
				const f = feeBreakdown(salePrice, DEFAULT_FEES);
				return salePrice - f.totalCents - buyPriceCents - outbound;
			});
			const p10 = percentile(nets, 0.1);
			const p90 = percentile(nets, 0.9);
			if (p10 !== null && p90 !== null) {
				netRangeCents = { p10Cents: p10, p90Cents: p90 };
			}
			probProfit = nets.filter((n) => n > 0).length / nets.length;
		}
	}

	// `opts.minNetCents ?? 0` — true break-even by default. The Safe bid
	// row's "max to break even" copy is now literal: this is the highest
	// price you can pay before fees + shipping eat the entire margin.
	// Callers wanting a profit floor pass `opts.minNetCents` explicitly
	// (e.g. /v1/discover passes 30 to filter for $30+ deals).
	const bidCeilingCents =
		market.meanCents > 0
			? bidCeiling(market.meanCents, opts.minNetCents ?? 0, {
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
					estimatedSaleCents: market.meanCents,
					feesCents: feeBreakdown(market.meanCents, DEFAULT_FEES).totalCents,
					shippingCents: outbound,
					targetNetCents: opts.minNetCents ?? 0,
				}
			: null;

	// Recommended exit — runs the full hazard model + competition factor
	// + active-blend search to pick the price that maximises $/day. Then
	// subtract buy cost so the surfaced net is true flipping profit, not
	// gross sale-side net (which is what optimalListPrice returns natively).
	const askPriceCents = (opts.asks ?? [])
		.map((a) => toCents(a.price?.value))
		.filter((p) => p > 0);
	// Listing type is the union of ItemSummary | ItemDetail; categoryId
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
	let recommendedExit: DealVerdict["recommendedExit"] = null;
	if (advice) {
		const flippingNetCents = advice.netCents - buyPriceCents;
		recommendedExit = {
			listPriceCents: advice.listPriceCents,
			expectedDays: advice.expectedDaysToSell,
			netCents: flippingNetCents,
			dollarsPerDay: Math.round(flippingNetCents / Math.max(advice.expectedDaysToSell, 1)),
		};
	}

	return {
		isDeal: s.rating === "buy",
		netCents: s.netCents,
		confidence: s.confidence,
		landedCostCents,
		signals,
		rating: s.rating,
		reason: s.reason,
		bidCeilingCents,
		safeBidBreakdown,
		probProfit,
		netRangeCents,
		recommendedExit,
	};
}

// Re-exported so callers get cents-conversion without importing adapter.js directly.
export { toCents };
