/**
 * Buyer-side fraud + recovery risk for sourcing decisions.
 *
 * Surfaces the three numbers a reseller needs to combine with the
 * sale-side `successNet` to compute the true expected net per trade:
 *
 *   1. P_fraud — Beta-Bernoulli posterior over seller feedback, then
 *      Bayes-updated by a price-anomaly factor when the listing is
 *      priced far below the trust-weighted legit market reference.
 *      The candidate's own credibility tempers that price evidence.
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
 *   - "Trustworthy seller is safer" emerges from the Beta posterior
 *     plus the trust-temper on price evidence (credible identities
 *     rarely commit fraud regardless of how the listing is priced).
 *   - "Too good to be true is suspect" emerges from the price-anomaly
 *     Bayes factor against a credibility-weighted legit reference —
 *     the reference itself filters out fraud-bait sold transactions.
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
	/** Median sold price for the same SKU (cents). When provided, a
	 *  price-anomaly Bayes factor pulls P_fraud up for listings priced
	 *  far below median ("too good to be true"). */
	marketMedianCents?: number;
	/** Sold-price std-dev (cents). Calibrates the legitimate-listing
	 *  dispersion in the price-anomaly update — wide markets tolerate
	 *  deeper discounts before flagging fraud. */
	marketStdDevCents?: number;
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
 * Probability of fraud / not-as-described given seller feedback +
 * (when supplied) the listing's price relative to market median.
 *
 * Stage 1 — feedback posterior (Beta-Bernoulli):
 *   Each feedback is a Bernoulli trial (positive/negative). With a
 *   Beta(α, β) prior on the underlying fraud rate, the posterior
 *   given (n_pos, n_neg) is Beta(α + n_pos, β + n_neg). We use
 *   `mean + 1σ` — a conservative upper bound that automatically
 *   accounts for sample-size uncertainty:
 *     - 1 feedback × 100% positive → posterior wide → high upper bound
 *     - 1000 feedbacks × 100% positive → tight posterior → near-zero
 *
 * Stage 2 — price-anomaly Bayes update (when median + std supplied):
 *   The same Bayesian conditioning that handles feedback also applies
 *   to "is this priced like a legit listing or like bait?". We compare
 *   two likelihoods at the listing's price ratio r = buy/median:
 *     P(r | legit)  ≈ Gaussian(1.0, max(0.15, empiricalCV))
 *     P(r | fraud)  ≈ Gaussian(0.5, 0.20),  saturated to r = 0.5 below
 *   The Bayes factor multiplies the prior odds. Empirical CV calibrates
 *   the legitimate-listing dispersion to the actual market — tight
 *   markets flag low prices aggressively, wide markets tolerate them.
 *
 * Final cap: 0.85. The previous 0.5 cap pre-dated the price-anomaly
 * update and would clip strong combined evidence (e.g., 0fb × no returns
 * × 50%-of-median pricing). 0.85 leaves room to express "almost
 * certainly a scam" without ever asserting certainty.
 *
 * Anchors (no price signal — feedback only, prior α=5, β=0.05):
 *   - score undefined (missing data):    ~5%
 *   - 1 fb × 100% positive:               ~4%
 *   - 10 fb × 100% positive:              ~2%
 *   - 100 fb × 100% positive:             ~0.3%
 *   - 100 fb × 95% positive:              ~7%
 *   - 100 fb × 90% positive:              ~13%
 *
 * Anchors with price signal (0fb, no percent — prior 5%):
 *   - r = 1.0 (priced at median):         5%   (no update)
 *   - r = 0.7, market CV = 0.20:          ~22%
 *   - r = 0.5, market CV = 0.20:          ~58%
 *   - r = 0.5, market CV = 0.50:          ~17%   (wide market dampens)
 *   - r = 0.3, market CV = 0.20:          ~74%
 */
const PRIOR_ALPHA = 5; // prior "good" pseudocount
const PRIOR_BETA = 0.05; // prior "bad" pseudocount — anchors no-data rate at ~1%
const P_FRAUD_CAP = 0.85;
const PRICE_BF_CAP = 25; // hard limit on a single piece of evidence
const FRAUD_PRICE_MEAN = 0.5; // typical bait pricing: "too good but not unbelievable"
const FRAUD_PRICE_STD = 0.2;
const LEGIT_PRICE_MEAN = 1.0;
const LEGIT_PRICE_STD_FLOOR = 0.15; // even tight markets allow some clearance pricing
// Reputation × sample-size shrinkage. Both knobs are reseller-intuitive:
//   - NEG_PENALTY=10: "1% negative rate costs 10% trust" — 10% neg = 0 trust.
//     Captures the asymmetry resellers actually use (each negative is loud).
//   - K=20: "20 trades = half trust at 100% positive" — sample-size shrinkage,
//     same shape as the legit-reference cohort gate.
const TRUST_NEG_PENALTY = 10;
const TRUST_K = 20;

/**
 * Continuous trust weight for a seller given feedback signals. Two factors
 * multiplied:
 *
 *   reputation = max(0, 1 − NEG_PENALTY × negRate)
 *   sample     = fb / (fb + K)
 *   trust      = reputation × sample
 *
 * No cliff in either pct or fb. The previous `(pct − 95)/5` shape created
 * a hard 0 below 95% positive — but a 92.9%-pct seller with 158 trades is
 * a real, imperfect reseller, not zero-information. The negative-rate
 * penalty reflects what resellers actually do: each percentage point of
 * negative feedback drops trust by 10pp, capped at 0 around 10% neg.
 *
 * Used symmetrically in two places:
 *   1. Adapter weights sold-pool comparables when computing the legit
 *      market reference distribution.
 *   2. `assessRisk` tempers the price-anomaly Bayes factor by the
 *      candidate seller's own trust — credible identities don't commit
 *      fraud, so the BF shrinks toward 1.
 */
export function sellerTrust(feedbackScore: number | undefined, feedbackPercent: number | undefined): number {
	const fb = feedbackScore ?? 0;
	if (fb <= 0) return 0;
	const pct = feedbackPercent ?? 100;
	if (!Number.isFinite(pct)) return 0;
	const negRate = Math.max(0, 100 - pct) / 100;
	const reputation = Math.max(0, 1 - TRUST_NEG_PENALTY * negRate);
	const sample = fb / (fb + TRUST_K);
	return reputation * sample;
}

function gaussianPdf(x: number, mean: number, std: number): number {
	const z = (x - mean) / std;
	return Math.exp(-0.5 * z * z) / std;
}

function priceAnomalyBayesFactor(
	buyCents: number,
	medianCents: number | undefined,
	stdDevCents: number | undefined,
): number {
	if (!medianCents || medianCents <= 0 || buyCents <= 0) return 1;
	const r = buyCents / medianCents;
	if (r >= LEGIT_PRICE_MEAN) return 1; // priced at/above median: no fraud signal

	// Empirical CV calibrates the legit-listing spread to this SKU's
	// actual market. Tight markets (CV ~0.10) penalize a 30%-discount
	// hard; wide markets (CV ~0.50) treat the same discount as
	// within-distribution.
	const cv = stdDevCents && stdDevCents > 0 ? stdDevCents / medianCents : LEGIT_PRICE_STD_FLOOR;
	const legitStd = Math.max(LEGIT_PRICE_STD_FLOOR, cv);

	// Saturate the lower tail: r → 0 should stay maximally suspicious,
	// not drop back through the fraud Gaussian's left tail.
	const fraudR = Math.max(FRAUD_PRICE_MEAN, r);

	const fLeg = gaussianPdf(r, LEGIT_PRICE_MEAN, legitStd);
	const fFraud = gaussianPdf(fraudR, FRAUD_PRICE_MEAN, FRAUD_PRICE_STD);
	if (fLeg <= 0) return PRICE_BF_CAP;
	// Floor at 1 — price evidence should only ever push fraud probability
	// up (it's a "too good to be true" signal), never down. The legit
	// Gaussian can peak above the fraud one in the (0.7, 1.0) band, which
	// would otherwise produce a fractional BF.
	return Math.max(1, Math.min(PRICE_BF_CAP, fFraud / fLeg));
}

function fraudProbability(score: number | undefined, percent: number | undefined, priceBF: number): number {
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
	const pBase = Math.min(0.999, mean + std);

	if (priceBF <= 1) return Math.min(P_FRAUD_CAP, pBase);
	const odds = pBase / Math.max(1e-9, 1 - pBase);
	const updated = odds * priceBF;
	return Math.min(P_FRAUD_CAP, updated / (1 + updated));
}

/**
 * Trust-tempered price BF. A high-credibility candidate has a vested
 * identity — the price-anomaly evidence shrinks toward 1 (no update)
 * because that seller doesn't commit fraud regardless of price. Linear
 * interpolation between the raw BF (trust=0, anonymous) and 1
 * (trust=1, fully verified). Symmetric companion to the trust weights
 * the legit-reference cohort uses on the supply side.
 */
function temperedBF(rawBF: number, candidateTrust: number): number {
	return 1 + (1 - candidateTrust) * (rawBF - 1);
}

export function assessRisk(input: RiskInputs): RiskAssessment {
	const rawPriceBF = priceAnomalyBayesFactor(input.buyPriceCents, input.marketMedianCents, input.marketStdDevCents);
	const candidateTrust = sellerTrust(input.sellerFeedbackScore, input.sellerFeedbackPercent);
	const priceBF = temperedBF(rawPriceBF, candidateTrust);
	const P_fraud = fraudProbability(input.sellerFeedbackScore, input.sellerFeedbackPercent, priceBF);

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
