/**
 * Scoring phase — the per-user, listing-decision layer that sits on top
 * of `MarketViewDigest`. Takes the upstream MarketView (item + matched
 * pools + market stats) plus the caller's own opts (forwarder cost,
 * minNet thresholds) and produces the `evaluation` field: rating,
 * expectedNet, bid ceiling, recommended exit, risk.
 *
 * Two evaluations run side-by-side — one against the cleaned pool
 * (suspicious EXcluded, the default UI view), one against the full
 * matched pool (suspicious INcluded). UI's "show suspicious" toggle
 * flips the headline numbers in lockstep with which comps are visible.
 * Pure quant math; no extra IO because the duration-enriched dates ride
 * along on the comp objects from the same enrich call.
 *
 * Pure: no DB, no upstream IO.
 */

import type { EvaluatePartial } from "@flipagent/types";
import type { ItemSummary } from "@flipagent/types/ebay/buy";
import type { MarketViewDigest } from "../market-data/market.js";
import { emitPartial, type PipelineListener, withStep } from "../market-data/pipeline.js";
import { evaluateWithContext } from "./evaluate-with-context.js";
import type { EvaluateOptions } from "./types.js";

export interface ScoreInput {
	digest: MarketViewDigest;
	opts?: EvaluateOptions;
	/** Echoed in the trace request body for observability — the same ProductRef the caller passed. */
	ref: { kind: string; [k: string]: unknown };
	onStep?: PipelineListener;
	cancelCheck?: () => Promise<void>;
}

export async function scoreFromDigest(input: ScoreInput): Promise<{ evaluation: unknown; evaluationAll: unknown }> {
	const { digest, opts, ref, onStep, cancelCheck } = input;

	const result = await withStep(
		{
			key: "evaluate",
			label: "Evaluate",
			request: { method: "POST", path: "/v1/evaluate", body: { ref, opts } },
			onStep,
			cancelCheck,
		},
		async () => {
			// Default view — suspicious comps already excluded from
			// `matchedSold` / `matchedActive` upstream.
			const ev = await evaluateWithContext(digest.anchor as ItemSummary, {
				...opts,
				sold: digest.matchedSold,
				asks: digest.matchedActive,
			});
			// Toggle view — same scoring against the full matched pool
			// (suspicious comps included). Hydrates the UI's "show
			// suspicious" toggle without a server roundtrip.
			const evAll = await evaluateWithContext(digest.anchor as ItemSummary, {
				...opts,
				sold: digest.matchedSoldAll,
				asks: digest.matchedActiveAll,
			});
			emitPartial(onStep, {
				evaluation: ev as EvaluatePartial["evaluation"],
				evaluationAll: evAll as EvaluatePartial["evaluation"],
			});
			return {
				value: { evaluation: ev, evaluationAll: evAll },
				result: { evaluation: ev, evaluationAll: evAll, market: digest.market },
			};
		},
	);

	return result;
}
