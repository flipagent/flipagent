/**
 * Buyer-side fraud + recovery risk for sourcing decisions.
 *
 * Surfaces the three numbers a reseller needs to combine with the
 * sale-side `successNet` to compute the true expected net per trade:
 *
 *   1. P_fraud — derived from seller feedback count + percent.
 *   2. withinReturnWindow — cycle (buy → list → sell → buyer-claim →
 *      you-return-to-seller) fits inside the seller's return window.
 *   3. maxLossCents — worst case:
 *      - within window: just the return shipping cost
 *      - else: full buy price (item gone, no recovery)
 *
 * The orchestrator (evaluate.ts) computes the true probabilistic
 * expected net:
 *
 *   E[net] = (1 − P_fraud) × successNet − P_fraud × maxLossCents
 *
 * Why this shape:
 *   - "Fast-selling items are safer" emerges naturally — short E[T_sell]
 *     keeps cycleDays under the return window, so canReturn=true caps
 *     maxLoss at the small return-shipping figure.
 *   - "Trustworthy seller is safer" emerges from P_fraud's exponential
 *     decay in feedback count.
 *   - "No-returns seller raises stakes" emerges from canReturn=false
 *     forcing maxLoss = full buy price.
 */

const TYPICAL_RETURN_SHIP_CENTS = 1500; // ~$15 USPS Ground Advantage 1-2lb

// Cycle padding (days). Conservative — better to underestimate canReturn
// than to overpromise it.
//
// `cycleDays` plays two roles below, both numerically equal to
// 11 + expectedDaysToSell, by symmetry of the shipping leg:
//
// (1) Capital-lock denominator for dollarsPerDay:
//       INBOUND(3) + LIST_PREP(2) + sellDays + OUTBOUND(3) + BUYER_CLAIM(3)
//       = time from your payment to capital release.
//
// (2) Return-window fit check:
//       LIST_PREP + sellDays + OUTBOUND + BUYER_CLAIM + RETURN_SHIP
//       = time from your receipt to return-to-seller completion.
//       (RETURN_SHIP = INBOUND, both are the same USPS Ground Advantage leg
//       in opposite directions, so we reuse INBOUND_DAYS.)
const INBOUND_DAYS = 3;
const LIST_PREP_DAYS = 2;
const OUTBOUND_DAYS = 3;
const BUYER_CLAIM_DAYS = 3;

/**
 * Fixed days of capital lock-up that bookend the variable sell-leg.
 * Exported so other modules (e.g., score.ts's $/day metric) compute the
 * same denominator as `assessRisk.cycleDays`.
 */
export const CYCLE_OVERHEAD_DAYS = INBOUND_DAYS + LIST_PREP_DAYS + OUTBOUND_DAYS + BUYER_CLAIM_DAYS;

export interface RiskInputs {
	/** Seller's positive-feedback count from the marketplace. */
	sellerFeedbackScore?: number;
	/** Seller's positive-feedback percent (0-100). */
	sellerFeedbackPercent?: number;
	/** All-in buy price (item + inbound shipping), cents. */
	buyPriceCents: number;
	/** Does the seller accept returns? */
	acceptsReturns: boolean;
	/** Seller's return window in days. */
	returnWindowDays?: number;
	/** Who pays return shipping: 'buyer' (us) or 'seller'. */
	returnShipPaidBy?: "buyer" | "seller";
	/** Mean days-to-sell for our resale, from `recommendListPrice`. */
	expectedDaysToSell: number;
}

export interface RiskAssessment {
	/** Probability of fraud / not-as-described / undelivered. 0..1. */
	P_fraud: number;
	/** True iff acceptsReturns AND cycleDays ≤ returnWindowDays. */
	withinReturnWindow: boolean;
	/** Worst-case downside in cents (full buy price, or just return ship). */
	maxLossCents: number;
	/** Total cycle days (buy → return-eligible). */
	cycleDays: number;
	/** Human-readable summary. */
	reason: string;
}

/**
 * Probability of fraud / not-as-described given seller feedback signals.
 *
 * Beta-Bernoulli posterior: each feedback is a Bernoulli trial (positive
 * or negative). With a Beta(α, β) prior on the underlying fraud rate,
 * the posterior given (n_pos, n_neg) is Beta(α + n_pos, β + n_neg).
 * We return `mean + 1σ` of the posterior — a conservative upper bound
 * that automatically accounts for sample-size uncertainty:
 *
 *   - 1 feedback × 100% positive → posterior is wide → high upper bound
 *   - 1000 feedbacks × 100% positive → tight posterior → near-zero
 *
 * Replaces the previous `base × piecewise-penalty` form, which had two
 * problems: (1) staircase cliffs in the percent dimension, and (2)
 * count and percent compounded multiplicatively without considering
 * that low-count percent estimates have huge variance.
 *
 * Anchors with current prior (α=5, β=0.05, +1σ):
 *   - score undefined (missing data):    ~4%
 *   - 1 fb × 100% positive:               ~4%
 *   - 10 fb × 100% positive:              ~2%
 *   - 100 fb × 100% positive:             ~0.3%
 *   - 1000 fb × 100% positive:            ~0.03%
 *   - 100 fb × 99% positive:              ~2%
 *   - 100 fb × 95% positive:              ~7%
 *   - 100 fb × 90% positive:              ~13%
 *   - 5 fb × 90% positive:                ~12%
 *   - 1500 fb × 99.5% positive:           ~0.7%
 */
const PRIOR_ALPHA = 5; // prior "good" pseudocount
const PRIOR_BETA = 0.05; // prior "bad" pseudocount — anchors no-data rate at ~1%

function fraudProbability(score: number | undefined, percent: number | undefined): number {
	const n = score ?? 0;
	const pct = percent ?? 99;
	const nNeg = (n * Math.max(0, 100 - pct)) / 100;
	const nPos = n - nNeg;

	const a = PRIOR_ALPHA + nPos;
	const b = PRIOR_BETA + nNeg;
	const total = a + b;

	const mean = b / total;
	const variance = (a * b) / (total * total * (total + 1));
	const std = Math.sqrt(variance);

	return Math.min(0.5, mean + std);
}

export function assessRisk(input: RiskInputs): RiskAssessment {
	const P_fraud = fraudProbability(input.sellerFeedbackScore, input.sellerFeedbackPercent);

	// Compare float cycle vs window for truthful fit-check, then ceil to
	// integer days for the wire surface (planning happens on whole-day
	// boundaries; ceil leans conservative — if math says 14.4d, plan 15d).
	const cycleDaysExact = INBOUND_DAYS + LIST_PREP_DAYS + input.expectedDaysToSell + OUTBOUND_DAYS + BUYER_CLAIM_DAYS;
	const windowDays = input.returnWindowDays ?? 0;
	const withinReturnWindow = input.acceptsReturns && cycleDaysExact <= windowDays;
	const cycleDays = Math.ceil(cycleDaysExact);

	const returnShipCents = input.returnShipPaidBy === "buyer" ? TYPICAL_RETURN_SHIP_CENTS : 0;
	const maxLossCents = withinReturnWindow ? returnShipCents : input.buyPriceCents;

	const fraudPctStr = (P_fraud * 100).toFixed(1);
	let reason: string;
	if (withinReturnWindow) {
		reason = `${fraudPctStr}% fraud risk; ${cycleDays}d cycle within ${windowDays}d return window — max loss $${(maxLossCents / 100).toFixed(0)}`;
	} else if (input.acceptsReturns && windowDays > 0) {
		reason = `${fraudPctStr}% fraud risk; ${cycleDays}d cycle exceeds ${windowDays}d return window — max loss $${(maxLossCents / 100).toFixed(0)}`;
	} else {
		reason = `${fraudPctStr}% fraud risk; no returns accepted — max loss $${(maxLossCents / 100).toFixed(0)}`;
	}

	return { P_fraud, withinReturnWindow, maxLossCents, cycleDays, reason };
}
