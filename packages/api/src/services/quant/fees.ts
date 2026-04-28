/**
 * Single source of truth for marketplace sale-fee math. Everything that
 * wants to subtract fees from a sale (margin.ts, decision.ts, future
 * P&L helpers) calls `feeBreakdown` so the formula stays in one place
 * — if a marketplace changes its fee structure or someone wires a
 * category-specific table, it changes here and only here.
 *
 * The model is the simplest one that fits eBay, Etsy, Mercari, Poshmark,
 * Depop, etc.: variable rate + fixed per-order + optional ad surcharge.
 * Marketplace-specific quirks (volume tiers, capped fees, category
 * carve-outs) are not modeled — pass a custom `FeeModel` per call when
 * you need them.
 */

import { DEFAULT_FEES, type FeeModel } from "./types.js";

export interface FeeBreakdown {
	/** Variable fee component, cents (rounded). `listPriceCents · feeRate`. */
	variableCents: number;
	/** Fixed per-order fee, cents (taken straight from the FeeModel). */
	fixedCents: number;
	/** Promotion / ad surcharge, cents (rounded). 0 when promotionRate is unset. */
	promotionCents: number;
	/** Sum of variableCents + fixedCents + promotionCents. */
	totalCents: number;
}

/**
 * Itemized fees on a sale of `listPriceCents`.
 *
 *   variableCents  = round(listPrice · feeRate)
 *   fixedCents     = fees.fixedCents
 *   promotionCents = round(listPrice · (promotionRate ?? 0))
 *   totalCents     = sum
 */
export function feeBreakdown(listPriceCents: number, fees: FeeModel = DEFAULT_FEES): FeeBreakdown {
	const variableCents = Math.round(listPriceCents * fees.feeRate);
	const fixedCents = fees.fixedCents;
	const promotionCents = Math.round(listPriceCents * (fees.promotionRate ?? 0));
	return {
		variableCents,
		fixedCents,
		promotionCents,
		totalCents: variableCents + fixedCents + promotionCents,
	};
}
