/**
 * Scoring phase of the evaluate pipeline — the per-user layer that
 * sits on top of `MarketDataDigest`. Takes the cached upstream digest
 * (item + matched pools + market stats) plus the caller's own opts
 * (forwarder destination, minNetCents threshold, …) and produces the
 * `evaluation` field: rating, expectedNet, bid ceiling, recommended
 * exit, signals.
 *
 * Pure-ish: no DB, no upstream IO. The only async is the LLM call
 * inside `evaluateWithContext` (when an explanation/signals model is
 * configured). Trace surface is one `evaluate` step, matching the
 * pre-split shape so existing trace UIs render identically.
 */

import type { EvaluatePartial } from "@flipagent/types";
import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { evaluateWithContext } from "./evaluate-with-context.js";
import type { MarketDataDigest } from "./market-data.js";
import { emitPartial, type PipelineListener, withStep } from "./pipeline.js";
import type { EvaluateOptions } from "./types.js";

export interface ScoreInput {
	digest: MarketDataDigest;
	opts?: EvaluateOptions;
	itemId: string;
	onStep?: PipelineListener;
	cancelCheck?: () => Promise<void>;
}

export async function scoreFromDigest(input: ScoreInput): Promise<{ evaluation: unknown; evaluationAll: unknown }> {
	const { digest, opts, itemId, onStep, cancelCheck } = input;

	const result = await withStep(
		{
			key: "evaluate",
			label: "Evaluate",
			request: { method: "POST", path: "/v1/evaluate", body: { itemId, opts } },
			onStep,
			cancelCheck,
		},
		async () => {
			// Default view — suspicious comps already excluded from
			// `matchedSold` / `matchedActive` upstream.
			const ev = await evaluateWithContext(digest.item as ItemSummary, {
				...opts,
				sold: digest.matchedSold,
				asks: digest.matchedActive,
			});
			// Toggle view — same scoring against the full pool. The UI's
			// "show suspicious" switch flips display + headline numbers
			// (recommended exit, expected net, queue position) in lockstep
			// with which comps are visible. Pure quant math; no extra IO
			// because the duration-enriched dates ride along on the comp
			// objects from the first call.
			const evAll = await evaluateWithContext(digest.item as ItemSummary, {
				...opts,
				sold: digest.matchedSoldAll,
				asks: digest.matchedActiveAll,
			});
			// Hydrate the verdict card the moment scoring resolves —
			// don't make the UI wait for the route's terminal `done`
			// event to render BUY/HOLD/SKIP + expected net.
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
