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

import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { evaluateWithContext } from "./evaluate-with-context.js";
import type { MarketDataDigest } from "./market-data.js";
import { type StepListener, withStep } from "./pipeline.js";
import type { EvaluateOptions } from "./types.js";

export interface ScoreInput {
	digest: MarketDataDigest;
	opts?: EvaluateOptions;
	itemId: string;
	onStep?: StepListener;
	cancelCheck?: () => Promise<void>;
}

export async function scoreFromDigest(input: ScoreInput): Promise<{ evaluation: unknown }> {
	const { digest, opts, itemId, onStep, cancelCheck } = input;

	const evaluation = await withStep(
		{
			key: "evaluate",
			label: "Evaluate",
			request: { method: "POST", path: "/v1/evaluate", body: { itemId, opts } },
			onStep,
			cancelCheck,
		},
		async () => {
			const ev = await evaluateWithContext(digest.item as ItemSummary, {
				...opts,
				sold: digest.matchedSold,
				asks: digest.matchedActive,
			});
			return { value: ev, result: { evaluation: ev, market: digest.market } };
		},
	);

	return { evaluation };
}
