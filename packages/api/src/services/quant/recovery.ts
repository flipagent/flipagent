/**
 * "If I buy at $X, will I get my money back (plus a margin) within N days?"
 *
 * Composes the existing hazard model (`λ(z) = λ₀ · exp(−β·z)`) with a
 * fee model to translate a cost basis + minimum net into the minimum
 * SELL price the user would need to charge, and reports the probability
 * of selling at or above that price within the requested window.
 *
 * Math (mirrors `optimalListPrice`):
 *   minSellPrice solves:  P · (1 − feeRate) − fixedFees − ship − costBasis − minNet = 0
 *   z(P)        = (P − meanCents) / stdDevCents              (linear z)
 *   λ(z)        = (1 / meanDaysToSell) · exp(−β · z)
 *   probability = 1 − exp(−λ · withinDays)
 *
 * Returns `probability: 0` when:
 *   - No `meanDaysToSell` (no duration data, no model)
 *   - The required minSellPrice is below the user's cost basis (always
 *     loses money — no point computing the hazard)
 *   - The required minSellPrice is unreachable in the price distribution
 */

import { feeBreakdown } from "./fees.js";
import { DEFAULT_ELASTICITY } from "./lifecycle.js";
import { DEFAULT_FEES, type FeeModel, type MarketStats } from "./types.js";

export interface RecoveryInput {
	market: MarketStats;
	costBasisCents: number;
	withinDays: number;
	minNetCents?: number;
	outboundShippingCents?: number;
	fees?: FeeModel;
	beta?: number;
}

export interface RecoveryResult {
	probability: number;
	minSellPriceCents: number;
	expectedDaysToSell?: number;
	nDurations: number;
	confidence: "high" | "medium" | "low" | "none";
	reason: string;
}

/**
 * Solve for the minimum sell price `P` that clears
 *   P − feeRate·P − fixedFees − ship − costBasis − minNet ≥ 0
 *
 * Iterative: fees-as-a-function-of-price means a single closed-form
 * formula can't be cleanly written without a category-by-category
 * lookup. 8 iterations converge to ≤ 1¢ for the eBay fee schedules
 * we ship today.
 */
function solveMinSellPrice(target: number, fees: FeeModel, outboundShippingCents: number): number {
	let p = target;
	for (let i = 0; i < 8; i++) {
		const fb = feeBreakdown(p, fees);
		const next = target + fb.totalCents + outboundShippingCents;
		if (Math.abs(next - p) < 1) {
			p = next;
			break;
		}
		p = next;
	}
	return Math.max(1, Math.round(p));
}

function classifyConfidence(n: number): RecoveryResult["confidence"] {
	if (n === 0) return "none";
	if (n >= 10) return "high";
	if (n >= 5) return "medium";
	return "low";
}

export function recoveryProbability(input: RecoveryInput): RecoveryResult {
	const market = input.market;
	const costBasis = Math.max(0, Math.round(input.costBasisCents));
	const withinDays = Math.max(1, Math.round(input.withinDays));
	const minNet = Math.max(0, Math.round(input.minNetCents ?? 0));
	const ship = Math.max(0, Math.round(input.outboundShippingCents ?? 0));
	const fees = input.fees ?? DEFAULT_FEES;
	const beta = input.beta ?? DEFAULT_ELASTICITY;
	const nDurations = market.nDurations ?? 0;

	const minSellPriceCents = solveMinSellPrice(costBasis + minNet, fees, ship);

	if (!market.meanDaysToSell || market.meanDaysToSell <= 0) {
		return {
			probability: 0,
			minSellPriceCents,
			nDurations,
			confidence: "none",
			reason: "No time-to-sell data — can't model the hazard.",
		};
	}
	if (market.stdDevCents <= 0 || market.meanCents <= 0) {
		return {
			probability: 0,
			minSellPriceCents,
			nDurations,
			confidence: classifyConfidence(nDurations),
			reason: "Price distribution is degenerate — not enough spread to fit a model.",
		};
	}

	const z = (minSellPriceCents - market.meanCents) / market.stdDevCents;
	const lambda0 = 1 / market.meanDaysToSell;
	const lambda = lambda0 * Math.exp(-beta * z);
	if (!Number.isFinite(lambda) || lambda <= 0) {
		return {
			probability: 0,
			minSellPriceCents,
			nDurations,
			confidence: classifyConfidence(nDurations),
			reason: `Required sell price $${(minSellPriceCents / 100).toFixed(0)} is too far above the market — model gives ~0% chance.`,
		};
	}

	const probability = Math.max(0, Math.min(1, 1 - Math.exp(-lambda * withinDays)));
	const expectedDaysToSell = 1 / lambda;
	const confidence = classifyConfidence(nDurations);

	return {
		probability,
		minSellPriceCents,
		expectedDaysToSell,
		nDurations,
		confidence,
		reason: `${Math.round(probability * 100)}% chance of selling at $${Math.round(minSellPriceCents / 100)}+ within ${withinDays} day${withinDays === 1 ? "" : "s"}.`,
	};
}
