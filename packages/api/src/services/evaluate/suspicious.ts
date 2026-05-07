/**
 * Per-comp "suspicious listing" filter — runs AFTER the LLM identity
 * matcher confirms a listing is the same product. Single source of
 * truth: `quant.assessRisk` → P_fraud (Bayesian seller-feedback +
 * trust-tempered price-anomaly evidence). Comps with P_fraud above the
 * threshold are excluded from the default-view median; UI's "show
 * suspicious" toggle exposes them on demand.
 *
 * One rule, one number. If quant's pFraud has gaps for specific
 * patterns (high-trust sellers selling occasional fakes — counterfeit-
 * prone categories like AirPods / Le Creuset / Tom Ford), the right
 * fix is in `quant/risk.ts` (loosen trust-temper, raise BF cap), not
 * here. This filter stays a thin gate over a single Bayesian score.
 *
 * Threshold rationale (from `audit-suspect-price-rejects.ts` on 66
 * historical "suspect price" rejects across 18 seeds):
 *   - 33 rows had P_fraud < 0.10 (clearly safe — false rejects today)
 *   - 21 rows had P_fraud 0.10-0.30 (probably safe)
 *   - 12 rows had P_fraud > 0.40 (probably scam — quant agrees)
 *   - Natural gap at 0.32-0.42 → 0.40 is the splitting threshold.
 */

import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { assessRisk } from "../quant/risk.js";
import { toCents } from "../shared/money.js";
import { isAuthenticityGuaranteed, legitMarketReference } from "./adapter.js";

const P_FRAUD_FLAG = 0.4;

export interface SuspiciousAssessment {
	/** True iff `pFraud > P_FRAUD_FLAG`. */
	suspicious: boolean;
	/** Bayesian fraud probability from `quant/risk.assessRisk`. 0..0.85. */
	pFraud: number;
	/** Short human-readable explanation when `suspicious` is true; empty otherwise. */
	reason: string;
}

function priceOf(item: ItemSummary): number {
	const v = toCents(item.price?.value);
	const ship = item.shippingOptions?.[0]?.shippingCost ? toCents(item.shippingOptions[0].shippingCost.value) : 0;
	return v + (ship || 0);
}

function pctNum(s: string | undefined): number | undefined {
	if (!s) return undefined;
	const n = Number.parseFloat(s);
	return Number.isFinite(n) ? n : undefined;
}

/**
 * Score one comp. `marketRef` should be the trust-weighted median/std of
 * the WHOLE matched pool (sold ∪ active), not the seed price — comparing
 * to the cohort the matcher established is what makes the price-anomaly
 * Bayes factor inside `assessRisk` data-driven instead of seed-anchored.
 */
export function assessSuspicious(
	item: ItemSummary,
	marketRef: { medianCents: number; stdDevCents: number } | null,
): SuspiciousAssessment {
	const buyCents = priceOf(item);
	const risk = assessRisk({
		sellerFeedbackScore: item.seller?.feedbackScore,
		sellerFeedbackPercent: pctNum(item.seller?.feedbackPercentage),
		buyPriceCents: buyCents,
		acceptsReturns: false, // not material for P_fraud
		expectedDaysToSell: 30, // not material for P_fraud
		marketMedianCents: marketRef?.medianCents,
		marketStdDevCents: marketRef?.stdDevCents,
		authenticityGuaranteed: isAuthenticityGuaranteed(item),
	});

	const suspicious = risk.P_fraud > P_FRAUD_FLAG;
	const reason = suspicious ? `${(risk.P_fraud * 100).toFixed(0)}% fraud risk (seller × price evidence)` : "";

	return { suspicious, pFraud: risk.P_fraud, reason };
}

/**
 * Score every matched comp. Returns parallel maps the pipeline uses to
 * (a) build the `clean` view (default — suspicious excluded) and
 * (b) ship `suspiciousIds` to the wire so the UI can render the toggle
 * and show the dim/explanation on flagged rows.
 *
 * `marketRef` is computed once over the union of sold + active so both
 * sides see the same threshold.
 */
export function partitionSuspicious(
	matchedSold: ReadonlyArray<ItemSummary>,
	matchedActive: ReadonlyArray<ItemSummary>,
): {
	suspiciousIds: Record<string, { reason: string; pFraud: number }>;
	cleanSold: ItemSummary[];
	cleanActive: ItemSummary[];
} {
	const ref = legitMarketReference([...matchedSold, ...matchedActive]);
	const suspiciousIds: Record<string, { reason: string; pFraud: number }> = {};
	const cleanSold: ItemSummary[] = [];
	const cleanActive: ItemSummary[] = [];

	for (const it of matchedSold) {
		const a = assessSuspicious(it, ref);
		if (a.suspicious) suspiciousIds[it.itemId] = { reason: a.reason, pFraud: a.pFraud };
		else cleanSold.push(it);
	}
	for (const it of matchedActive) {
		const a = assessSuspicious(it, ref);
		if (a.suspicious) suspiciousIds[it.itemId] = { reason: a.reason, pFraud: a.pFraud };
		else cleanActive.push(it);
	}

	return { suspiciousIds, cleanSold, cleanActive };
}
