import {
	isAuthenticityGuaranteed,
	legitMarketReference,
	marketFromSold,
	toQuantListing,
} from "../market-data/adapter.js";
import {
	assessRisk,
	bidCeiling,
	DEFAULT_FEES,
	feeBreakdown,
	filterIqrOutliers,
	veto as listingVeto,
	percentile,
	recommendListPrice,
	shrinkPosteriorMean,
} from "../quant/index.js";
import { toCents } from "../shared/money.js";
import { landedCost } from "../ship.js";
import type { EvaluableItem, EvaluateOptions, Evaluation, NetRangeCents } from "./types.js";

// Below this, percentile estimates are noise — IQR cleaning needs ≥4 anyway.
const MIN_SOLD_FOR_DISTRIBUTION = 4;

/**
 * Below this many sold comparables we refuse to recommend "buy". The
 * advice (recommended list price, expectedNet) may still compute on
 * very thin data, but a single sale is not a market — a reseller with
 * the raw data would say "skip, not enough signal" rather than trust
 * a one-shot recommendation. Surface the underlying sold/active pools
 * unchanged so the human can override.
 */
const MIN_SOLD_FOR_RATING = 6;

/**
 * Default outbound shipping when no forwarder leg supplied. $10 reflects
 * typical USPS Ground Advantage / Priority Mail for a 1-2lb US domestic
 * box. Cheap items will over-pay this estimate, heavy items will under-
 * pay; passing `opts.forwarder` swaps in the real landed-cost breakdown.
 * Caller can also override via `opts.outboundShippingCents` directly.
 */
const DEFAULT_OUTBOUND_SHIPPING_CENTS = 1000;

/**
 * Default rating gate — any positive risk-adjusted expected net clears.
 * Reseller utility above zero (capital efficiency, opportunity cost,
 * time/effort floor) is captured by `recommendedExit.dollarsPerDay`
 * and friends; the rating itself just answers "is this a profitable
 * trade?". Callers with a specific dollar floor pass `opts.minNetCents`.
 */
const DEFAULT_MIN_NET_CENTS = 0;

/**
 * Sample-size shrinkage strength on the sale-price anchor. With κ=5,
 * n=1 leans 83% on the prior (active-ask floor); n=5 splits 50/50;
 * n≥30 is essentially sample-only. Calibrated against 157 stored
 * evaluations — kills the "n=1 single-auction comp" false positives
 * without regressing healthy markets. See `scripts/audit-enet-liquidity.ts`.
 */
const SHRINKAGE_KAPPA = 5;

/**
 * Annualized capital opportunity cost used to NPV the resale inflow.
 * 30%/yr matches what resellers actually demand for the alternative
 * use of locked capital (other flips, Treasury, etc.). At 15-day
 * cycles the discount is ~1%; at 90 days ~7%; at 1+ year it bites
 * hard — which is exactly what should happen to "this'll never sell"
 * candidates. Tunable; see audit script.
 */
const OPPORTUNITY_RATE_PER_YEAR = 0.3;

/**
 * NPV discount factor for a buy→cash cycle of `cycleDays`. Continuous-
 * compounded so chained cycles compose cleanly. Applied to the
 * **inflow only** (sale proceeds), never to net — discounting a
 * negative net would make slow losses look less bad than fast losses,
 * which is the wrong direction.
 */
function discountFactor(cycleDays: number): number {
	if (!Number.isFinite(cycleDays) || cycleDays <= 0) return 1;
	return Math.exp((-OPPORTUNITY_RATE_PER_YEAR * cycleDays) / 365);
}

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
	// Always go through `marketFromSold` so the seed-velocity blend applies
	// uniformly — even when `opts.sold` is empty. The blend's niche-SKU
	// branch (marketRate=0 → seedRate verbatim) is what rescues that case;
	// short-circuiting to a hand-crafted EMPTY_MARKET would silently drop
	// the only signal we have. Multi-quantity listings (PDP "10 sold of 17")
	// carry the strongest single-listing demand evidence — the blend
	// surfaces it whether or not comps came back.
	// `windowDays` here must match the lookback the sold pool was fetched
	// for — the recency-weighted velocity estimator in `salesPerDayRecency`
	// decays observations on a tau ∝ windowDays scale, so a 30-day window
	// applied to a 90-day sample silently flattens 60+ day-old sales to
	// ~zero salesPerDay. Default 30 keeps back-compat for callers that
	// haven't wired the option yet.
	const market = marketFromSold(
		opts.sold ?? [],
		opts.lookbackDays != null ? { windowDays: opts.lookbackDays } : undefined,
		undefined,
		opts.asks,
		item,
	);

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

	// Bayes-Stein shrinkage on the sale-price anchor before the queue
	// model runs. The reseller's mental model is "1 sale isn't a market;
	// what's the cheapest realistic ask going for?" — so the prior is
	// the conservative ask floor (p25 of active asks), with the sample
	// p25 as a safety net when no asks are listed. With κ=5, n=1 collapses
	// 83% to the prior, n=5 splits 50/50, n≥30 is sample-only.
	//
	// `recommendListPrice` consumes only `medianCents` from the market;
	// passing it the shrunken value lets the existing cooling-drift /
	// queue / Erlang logic compose cleanly on top — no second knob.
	const askP25Cents = market.asks?.p25Cents;
	const sampleP25Cents = market.p25Cents;
	const shrinkagePrior =
		askP25Cents && askP25Cents > 0
			? Math.min(askP25Cents, sampleP25Cents > 0 ? sampleP25Cents : askP25Cents)
			: sampleP25Cents > 0
				? sampleP25Cents
				: market.medianCents;
	const nSold = opts.sold?.length ?? 0;
	const saleHatCents =
		market.medianCents > 0
			? shrinkPosteriorMean(nSold, market.medianCents, shrinkagePrior, SHRINKAGE_KAPPA)
			: market.medianCents;

	const advice = recommendListPrice(
		{ ...market, medianCents: saleHatCents },
		{
			fees: DEFAULT_FEES,
			outboundShippingCents: outbound,
			activeAskPrices: askPriceCents,
			buyPriceCents,
		},
	);

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
	// Legit reference for the price-anomaly Bayes update — trust-weighted
	// over the full sold pool (each comparable contributes proportional to
	// its seller's credibility). Falls back to null when no credible cohort
	// exists, in which case the price signal is suppressed and P_fraud
	// derives purely from the candidate's own feedback.
	const legit = legitMarketReference(opts.sold ?? []);
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
				marketMedianCents: legit?.medianCents,
				marketStdDevCents: legit?.stdDevCents,
				authenticityGuaranteed: isAuthenticityGuaranteed(item),
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
	//   successNet   = gross flip net IF the sale succeeds at the
	//                  shrunken-anchor list price. "Best-case if it sells."
	//
	//   expectedNet  = TRUE probabilistic E[net per trade], NPV form:
	//                    PV    = grossInflow · D(cycleDays) − buy
	//                    E[net] = (1 − P_fraud) · PV − P_fraud · maxLoss
	//                  Three independent random variables — sale price R,
	//                  time-to-cash T, fraud F — folded into one honest
	//                  expectation. Discount applies to the **inflow
	//                  only** (the buy is paid today, in today's dollars);
	//                  putting D on net would make slow losses look less
	//                  bad than fast ones, which is backwards.
	//                  THIS is what the rating uses.
	//
	//   maxLoss      = worst case downside (capital-preservation focus).
	const successNetCents = advice?.netCents ?? null;
	let expectedNetCents = 0;
	let discountFactorUsed = 1;
	if (advice && risk) {
		const fees = feeBreakdown(advice.listPriceCents, DEFAULT_FEES);
		const grossInflowCents = advice.listPriceCents - fees.totalCents - outbound;
		discountFactorUsed = discountFactor(risk.cycleDays);
		const pvCents = grossInflowCents * discountFactorUsed - buyPriceCents;
		expectedNetCents = Math.round((1 - risk.P_fraud) * pvCents - risk.P_fraud * risk.maxLossCents);
	}

	// Rating: single criterion on risk-adjusted expectedNet.
	//   - veto (factual broken condition)         → skip
	//   - no market activity (advice is null)     → skip
	//   - expectedNet < minNet                    → skip
	//   - else                                     → buy
	const minNet = opts.minNetCents ?? DEFAULT_MIN_NET_CENTS;
	let rating: "buy" | "skip";
	let reasonCode: Evaluation["reasonCode"];
	let reason: string;
	if (vetoReason) {
		rating = "skip";
		reasonCode = "vetoed";
		reason = `vetoed: ${vetoReason}`;
	} else if (advice == null) {
		rating = "skip";
		reasonCode = "no_market";
		reason = "no market activity (no sold pool or zero velocity)";
	} else if (nSold < MIN_SOLD_FOR_RATING) {
		rating = "skip";
		reasonCode = "insufficient_data";
		reason = `insufficient market data (${nSold} sold; min ${MIN_SOLD_FOR_RATING}) — see raw pools`;
	} else if (expectedNetCents < minNet) {
		rating = "skip";
		reasonCode = "below_min_net";
		if (risk && successNetCents != null) {
			const fraudPct = (risk.P_fraud * 100).toFixed(1);
			const dStr = discountFactorUsed.toFixed(2);
			reason = `NPV $${(expectedNetCents / 100).toFixed(0)} (success $${(successNetCents / 100).toFixed(0)} · D=${dStr} over ${risk.cycleDays}d cycle, P_fraud=${fraudPct}%) below $${(minNet / 100).toFixed(0)} threshold`;
		} else {
			reason = `expected net $${(expectedNetCents / 100).toFixed(0)} below $${(minNet / 100).toFixed(0)} threshold`;
		}
	} else {
		rating = "buy";
		reasonCode = "cleared";
		const dollarsStr = `$${(expectedNetCents / 100).toFixed(0)}`;
		const dStr = discountFactorUsed.toFixed(2);
		reason =
			risk && risk.P_fraud > 0.001
				? `${dollarsStr} expected (success $${((successNetCents ?? 0) / 100).toFixed(0)} · D=${dStr} · ${(100 * (1 - risk.P_fraud)).toFixed(1)}% no-fraud); ${risk.reason}`
				: `${dollarsStr} expected net (D=${dStr} over ${risk?.cycleDays ?? 0}d cycle)`;
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
	// gate. Default 0 (break-even) — pass `opts.minNetCents` to tighten.
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
		reasonCode,
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
