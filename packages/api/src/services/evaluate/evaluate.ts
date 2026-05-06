import {
	assessRisk,
	bidCeiling,
	DEFAULT_FEES,
	feeBreakdown,
	filterIqrOutliers,
	veto as listingVeto,
	type MarketStats,
	percentile,
	recommendListPrice,
} from "../quant/index.js";
import { toCents } from "../shared/money.js";
import { landedCost } from "../ship.js";
import { marketFromSold, toQuantListing } from "./adapter.js";
import type { EvaluableItem, EvaluateOptions, Evaluation, NetRangeCents } from "./types.js";

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
 * Default minimum expected-net per trade. Below this, a deal is "skip"
 * regardless of how clean the rest of the math looks — flippers don't
 * pick up dimes. $30 matches `netMargin`'s default `cleared` floor.
 */
const DEFAULT_MIN_NET_CENTS = 3000;

/**
 * Evaluate one listing against a sold pool and an optional forwarder leg.
 * Combines `recommendListPrice` (queue-based exit), `assessRisk` (P_fraud +
 * return-window math), and `landedCost` (forwarder breakdown when supplied)
 * into a single reseller-facing `Evaluation`.
 *
 * Without sold listings no margin signal is possible — the evaluation will be
 * `skip` with `expectedNetCents: 0`. Pass at least a handful.
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
		// Forwarder + customs are inbound costs (seller → forwarder → us)
		// the reseller pays before listing. We add them to the same outbound
		// slot the margin math uses because, once the buyer pays for final
		// shipping (the typical flow when listing post-forwarder), the
		// reseller's only out-of-pocket shipping IS the forwarder leg —
		// "outbound" here is reseller-side shipping cost regardless of
		// direction. Net = sale − fees − buy − this number.
		outboundShippingCents = breakdown.forwarderCents + breakdown.taxCents;
	} else if (opts.outboundShippingCents != null) {
		outboundShippingCents = opts.outboundShippingCents;
	} else {
		outboundShippingCents = DEFAULT_OUTBOUND_SHIPPING_CENTS;
	}

	// Factual veto only — descriptive net + days come from
	// `recommendListPrice` below, which prices at the actual list price
	// (anchor × 0.98) and runs the queue model.
	const vetoReason = listingVeto(listing);

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

	// Recommended exit — `recommendListPrice` picks the list price from a
	// cooling-aware sold/ask blend, then computes Erlang queue time at
	// that price. `netCents` already nets out the buy cost, so it flows
	// to the wire directly as flipping profit (not gross sale-side net).
	//
	// Exclude the candidate itself from the post-purchase competition
	// pool. If the user buys this listing, it leaves the active set —
	// they become the new seller, and their competition is everyone
	// else. Leaving the candidate in double-counts: the same listing
	// shows up as the buy target AND as a competitor in the queue model.
	// (The pre-purchase market summary above keeps the candidate in —
	// that's descriptive "what's the live market right now," not
	// post-purchase forecast.)
	const candidateId = item.itemId;
	const askPriceCents = (opts.asks ?? [])
		.filter((a) => a.itemId !== candidateId)
		.map((a) => toCents(a.price?.value))
		.filter((p) => p > 0);
	const advice = recommendListPrice(market, {
		fees: DEFAULT_FEES,
		outboundShippingCents: outbound,
		activeAskPrices: askPriceCents,
		buyPriceCents,
	});

	// Risk assessment: P_fraud × max-loss with cycle-vs-return-window
	// gating. Only meaningful when we have an exit prediction (need
	// expectedDaysToSell to compute the cycle). Computed before
	// recommendedExit so its cycleDays can re-base dollarsPerDay.
	const seller = item.seller;
	const returns = "returnTerms" in item ? item.returnTerms : undefined;
	// eBay's returnPeriod is { value, unit }. Normalize to days. Common
	// units: "DAY" (most), "MONTH" (rare). Anything else falls through
	// to undefined and risk treats as no-returns-window.
	const returnWindowDays =
		returns?.returnPeriod?.unit === "DAY"
			? returns.returnPeriod.value
			: returns?.returnPeriod?.unit === "MONTH"
				? returns.returnPeriod.value * 30
				: undefined;
	const returnShipPaidBy =
		returns?.returnShippingCostPayer === "BUYER"
			? "buyer"
			: returns?.returnShippingCostPayer === "SELLER"
				? "seller"
				: undefined;
	const risk = advice
		? assessRisk({
				sellerFeedbackScore: seller?.feedbackScore,
				sellerFeedbackPercent: seller?.feedbackPercentage
					? Number.parseFloat(seller.feedbackPercentage)
					: undefined,
				buyPriceCents,
				acceptsReturns: returns?.returnsAccepted ?? false,
				returnWindowDays,
				returnShipPaidBy,
				expectedDaysToSell: advice.expectedDaysToSell,
			})
		: null;

	// Surface recommended exit. dollarsPerDay is re-based on the FULL
	// buy→cash cycle (inbound + list-prep + sell + outbound + claim) —
	// `recommendListPrice` only knows the sell leg, but reseller capital
	// is locked across the whole cycle. Without this, fast SKUs look
	// disproportionately efficient because the fixed ~11d non-sell
	// overhead disappears. risk owns the cycle math, so we read it from
	// there.
	const recommendedExit: Evaluation["recommendedExit"] =
		advice && risk
			? {
					listPriceCents: advice.listPriceCents,
					expectedDaysToSell: advice.expectedDaysToSell,
					daysLow: advice.daysLow,
					daysHigh: advice.daysHigh,
					netCents: advice.netCents,
					dollarsPerDay: Math.round(advice.netCents / Math.max(risk.cycleDays, 1)),
					queueAhead: advice.queueAhead,
					asksAbove: advice.asksAbove,
				}
			: null;

	// Three honest numbers (each tells a different story to the reseller):
	//
	//   successNet   = gross flip net IF the sale succeeds.
	//                  "If it sells, what do I net?" Happy-path headline.
	//
	//   expectedNet  = TRUE probabilistic E[net per trade]
	//                = (1 − P_fraud) × successNet − P_fraud × maxLoss
	//                  Folds fraud probability + maxLoss into a single
	//                  honest expectation. THIS is what the rating uses.
	//
	//   maxLoss      = worst case downside (capital-preservation focus).
	//
	// When advice is null (no market velocity), there's no price to net
	// against — surface 0 and the rating gate below catches it. `risk`
	// is always non-null when advice is non-null (set together above), so
	// the probabilistic branch fires whenever there's anything to score.
	const successNetCents = advice?.netCents ?? null;
	const expectedNetCents =
		advice && risk ? Math.round((1 - risk.P_fraud) * advice.netCents - risk.P_fraud * risk.maxLossCents) : 0;

	// Rating: single criterion on risk-adjusted expectedNet.
	//   - veto (factual broken condition)         → skip
	//   - no market activity (advice is null)     → skip
	//   - expectedNet < minNet                    → skip
	//   - else                                     → buy
	const minNet = opts.minNetCents ?? DEFAULT_MIN_NET_CENTS;
	let rating: "buy" | "skip";
	let reason: string;
	if (vetoReason) {
		rating = "skip";
		reason = `vetoed: ${vetoReason}`;
	} else if (advice == null) {
		rating = "skip";
		reason = "no market activity (no sold pool or zero velocity)";
	} else if (expectedNetCents < minNet) {
		rating = "skip";
		if (risk && successNetCents != null) {
			const fraudPct = (risk.P_fraud * 100).toFixed(1);
			reason = `(1−${fraudPct}%) × $${(successNetCents / 100).toFixed(0)} − ${fraudPct}% × $${(risk.maxLossCents / 100).toFixed(0)} = $${(expectedNetCents / 100).toFixed(0)} below $${(minNet / 100).toFixed(0)} threshold`;
		} else {
			reason = `expected net $${(expectedNetCents / 100).toFixed(0)} below $${(minNet / 100).toFixed(0)} threshold`;
		}
	} else {
		rating = "buy";
		const dollarsStr = `$${(expectedNetCents / 100).toFixed(0)}`;
		reason =
			risk && risk.P_fraud > 0.001
				? `${dollarsStr} expected (success $${((successNetCents ?? 0) / 100).toFixed(0)} × ${(100 * (1 - risk.P_fraud)).toFixed(1)}%); ${risk.reason}`
				: `${dollarsStr} expected net`;
	}

	// Bid ceiling derives from the SAME exit price the recommendation row
	// shows ("resell at $X in ~Yd"), not the naive sold mean. That price
	// already incorporates the cooling-drift blend between sold reference
	// and active-ask median, so the buy ceiling stays in lockstep with the
	// realistic exit. Falls back to `market.meanCents` when no recommendation
	// could be computed (zero velocity, no sold pool) so callers still get
	// a number.
	//
	// Bid ceiling targets the same `minNet` floor the rating uses, so the
	// "highest you can pay and still earn $X" answer matches the rating
	// gate. Default $30 — pair it with the rating threshold.
	const exitBasisCents = advice?.listPriceCents ?? market.meanCents;
	const bidCeilingCents =
		exitBasisCents > 0
			? bidCeiling(exitBasisCents, minNet, {
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
					targetNetCents: minNet,
				}
			: null;

	return {
		successNetCents,
		expectedNetCents,
		maxLossCents: risk?.maxLossCents ?? null,
		landedCostCents,
		rating,
		reason,
		bidCeilingCents,
		safeBidBreakdown,
		netRangeCents,
		recommendedExit,
		risk: risk
			? {
					P_fraud: risk.P_fraud,
					withinReturnWindow: risk.withinReturnWindow,
					cycleDays: risk.cycleDays,
					reason: risk.reason,
				}
			: null,
	};
}
