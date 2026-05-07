/**
 * Net-margin math for marketplace flipping/resale. Given a buy price, a
 * projected sale price, and a fee model, return the cents-denominated
 * take-home and the per-trade ROI.
 *
 * Fee math is delegated to `fees.ts` — there is exactly one place in
 * the package where the sale-fee formula lives.
 */

import { type FeeBreakdown, feeBreakdown } from "./fees.js";
import { DEFAULT_FEES, type FeeModel, type MarginInputs } from "./types.js";

export interface Margin {
	/** Net cents after fees, after deducting buy + shipping costs. */
	netCents: number;
	/** netCents / buyPriceCents. Per-trade return on investment. */
	roi: number;
	/** True when net ≥ minimum threshold. */
	cleared: boolean;
	/** Itemized fees on the sale leg (variable, fixed, promotion). */
	feeBreakdown: FeeBreakdown;
}

/**
 * @param inputs see types.ts MarginInputs
 * @param minNetCents threshold for the `cleared` flag. Default 0 — any
 *        positive-net trade clears. Pass a stricter floor when the caller
 *        has a specific time/effort threshold in mind. Reseller utility
 *        beyond positive EV (capital efficiency, opportunity cost) is
 *        better expressed via `dollarsPerDay` on the recommendation, not
 *        a flat absolute floor.
 */
export function netMargin(inputs: MarginInputs, minNetCents = 0): Margin {
	const fees = inputs.fees ?? DEFAULT_FEES;
	const breakdown = feeBreakdown(inputs.estimatedSaleCents, fees);
	const inbound = inputs.inboundShippingCents ?? 0;
	const outbound = inputs.outboundShippingCents ?? 0;
	const netCents = inputs.estimatedSaleCents - breakdown.totalCents - inputs.buyPriceCents - inbound - outbound;
	const roi = inputs.buyPriceCents > 0 ? netCents / inputs.buyPriceCents : 0;
	return {
		netCents,
		roi,
		cleared: netCents >= minNetCents,
		feeBreakdown: breakdown,
	};
}

/**
 * Inverse: given a target take-home and the projected sale price, what's
 * the highest price you can bid? "Bid ceiling" — buy any higher and the
 * trade misses your margin floor.
 */
export function bidCeiling(
	estimatedSaleCents: number,
	targetNetCents: number,
	options: {
		fees?: FeeModel;
		inboundShippingCents?: number;
		outboundShippingCents?: number;
	} = {},
): number {
	const breakdown = feeBreakdown(estimatedSaleCents, options.fees ?? DEFAULT_FEES);
	const inbound = options.inboundShippingCents ?? 0;
	const outbound = options.outboundShippingCents ?? 0;
	return Math.max(0, estimatedSaleCents - breakdown.totalCents - inbound - outbound - targetNetCents);
}
