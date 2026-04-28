/**
 * Top-level entry: given a Listing + MarketStats, return a complete
 * `Score` — the quant view of a deal (expected return + ranking
 * metrics + factor exposures + bottom-line rating).
 *
 *   E[sale]      = market.meanCents · saleMultiplier
 *   E[net]       = E[sale] − fees(E[sale]) − cost − shipping
 *   liquid       = market.salesPerDay ≥ minSalesPerDay
 *   confidence   = listing-level signal product (seller / photos / desc)
 *
 * `meanCents` already integrates over the empirical sold-price
 * distribution (mean = Σ price·P(price) for past sales). One number
 * answers "what'll I make" — splitting into worst/best/expected
 * scenarios re-fragments information that's already in the mean.
 *
 * Rating is a sequential filter:
 *   veto         → skip
 *   illiquid     → skip
 *   E[net] < floor → skip
 *   no signal    → watch
 *   low conf     → watch
 *   else         → buy
 */

import { netMargin } from "./margin.js";
import { confidence as listingConfidence, veto as listingVeto } from "./quality.js";
import { belowAsks } from "./signals/competition.js";
import { endingSoonLowWatchers } from "./signals/ending-soon.js";
import { poorTitle } from "./signals/poor-title.js";
import { underMedian } from "./signals/under-median.js";
import type { FeeModel, Listing, MarketStats, Score, Signal } from "./types.js";

export interface ScoreOptions {
	/**
	 * Optional discount applied to expected sale price — your own
	 * pricing strategy ("list at 95% of market for fast turnover").
	 * Default 1.0 = list at expected market price. The empirical mean
	 * is what items actually sold for, so no implicit data adjustment
	 * is needed.
	 */
	saleMultiplier?: number;
	/** Inbound shipping (seller → forwarder), cents. */
	inboundShippingCents?: number;
	/** Outbound shipping (forwarder → buyer), cents. Often 0 since buyer pays. */
	outboundShippingCents?: number;
	fees?: FeeModel;
	/** Net-margin threshold (cents) under which a deal is "skip". Default $30. */
	minNetCents?: number;
	/** Confidence threshold under which a deal is "watch" not "buy". Default 0.4. */
	minConfidence?: number;
	/** Liquidity floor: minimum salesPerDay to consider buying. Default 0.5. */
	minSalesPerDay?: number;
}

export function score(listing: Listing, market: MarketStats, options: ScoreOptions = {}): Score {
	const vetoReason = listingVeto(listing);
	const saleMultiplier = options.saleMultiplier ?? 1;
	const buyPriceCents = listing.priceCents + (listing.shippingCents ?? 0);
	const expectedSaleCents = Math.round(market.meanCents * saleMultiplier);

	const margin = netMargin(
		{
			estimatedSaleCents: expectedSaleCents,
			buyPriceCents,
			inboundShippingCents: options.inboundShippingCents,
			outboundShippingCents: options.outboundShippingCents,
			fees: options.fees,
		},
		options.minNetCents,
	);

	const conf = vetoReason ? 0 : listingConfidence(listing);
	const minSalesPerDay = options.minSalesPerDay ?? 0.5;
	const liquid = market.salesPerDay >= minSalesPerDay;

	const signals: Signal[] = [];
	const um = underMedian(listing, market);
	if (um) signals.push(um);
	const ba = belowAsks(listing, market);
	if (ba) signals.push(ba);
	const es = endingSoonLowWatchers(listing);
	if (es) signals.push(es);
	const pt = poorTitle(listing);
	if (pt) signals.push(pt);

	const minConf = options.minConfidence ?? 0.4;
	let rating: "buy" | "watch" | "skip" = "skip";
	let reason: string;
	if (vetoReason) {
		reason = `vetoed: ${vetoReason}`;
	} else if (!liquid) {
		reason = `${market.salesPerDay.toFixed(2)}/day below liquidity floor ${minSalesPerDay}`;
	} else if (!margin.cleared) {
		reason = `expected net ${(margin.netCents / 100).toFixed(2)} below threshold`;
	} else if (signals.length === 0) {
		reason = "margin clears but no positive buy signal";
		rating = "watch";
	} else if (conf < minConf) {
		reason = `confidence ${conf.toFixed(2)} below ${minConf} — operator review`;
		rating = "watch";
	} else {
		rating = "buy";
		reason = signals.map((s) => s.reason).join("; ");
	}

	// Time-aware metrics — derived only when caller has list→sold duration data
	// in the market summary (Browse API itemCreationDate/itemEndDate or
	// SPRD-side duration tables). When missing, both fields stay undefined.
	let dollarsPerDay: number | undefined;
	let annualizedRoi: number | undefined;
	if (market.meanDaysToSell && market.meanDaysToSell > 0 && margin.netCents > 0 && buyPriceCents > 0) {
		dollarsPerDay = Math.round(margin.netCents / market.meanDaysToSell);
		// IRR cap at 10000%/yr — model breaks down at near-zero hold times.
		const ratio = (margin.netCents + buyPriceCents) / buyPriceCents;
		const exponent = 365 / Math.max(market.meanDaysToSell, 1);
		const raw = ratio ** exponent - 1;
		annualizedRoi = Number.isFinite(raw) ? Math.min(raw, 100) : 100;
	}

	return {
		listing,
		market,
		netCents: margin.netCents,
		roi: margin.roi,
		dollarsPerDay,
		annualizedRoi,
		liquid,
		confidence: conf,
		signals,
		rating,
		reason,
	};
}
