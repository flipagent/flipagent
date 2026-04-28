import {
	bidCeiling,
	DEFAULT_FEES,
	feeBreakdown,
	filterIqrOutliers,
	type MarketStats,
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
	const market = opts.comps && opts.comps.length > 0 ? marketFromComps(opts.comps) : EMPTY_MARKET;

	let outboundShippingCents: number | undefined;
	let landedCostCents: number | null = null;
	if (opts.forwarder) {
		const breakdown = landedCost(item, opts.forwarder);
		landedCostCents = breakdown.totalCents;
		// The forwarder + tax leg is cost the *re-seller* pays after acquiring,
		// so it slots into outbound shipping for margin math.
		outboundShippingCents = breakdown.forwarderCents + breakdown.taxCents;
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
	const outbound = outboundShippingCents ?? 0;

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

	const bidCeilingCents =
		market.meanCents > 0
			? bidCeiling(market.meanCents, opts.minNetCents ?? 3000, {
					fees: DEFAULT_FEES,
					outboundShippingCents: outbound,
				})
			: null;

	return {
		isDeal: s.rating === "buy",
		netCents: s.netCents,
		confidence: s.confidence,
		landedCostCents,
		signals,
		rating: s.rating,
		reason: s.reason,
		bidCeilingCents,
		probProfit,
		netRangeCents,
	};
}

// Re-exported so callers get cents-conversion without importing adapter.js directly.
export { toCents };
