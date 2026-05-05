/**
 * `/v1/evaluate` pipeline entry. Splits into two phases:
 *
 *   1. **Upstream** (`fetchOrAwaitMarketData` in `market-data.ts`) —
 *      detail + sold/active search + LLM same-product filter + market
 *      stats + digest assembly. Cached cross-user in
 *      `market_data_cache` keyed on `(itemId, lookbackDays, soldLimit)`.
 *      A second caller asking for the same key inside the TTL window
 *      hits the cache; a second caller mid-fetch attaches to the
 *      in-flight leader's run instead of duplicating cost.
 *
 *   2. **Scoring** (`scoreFromDigest` in `score.ts`) — the per-user
 *      `evaluation` field, using the caller's `opts` (forwarder cost,
 *      minNetCents threshold). Always runs locally; never cached
 *      cross-user since opts diverge.
 *
 * The wire shape (`EvaluateResponse`) is unchanged from the pre-split
 * version — routes, SDK clients, and trace UIs see no surface diff.
 *
 * `onStep` listener semantics:
 *   - cache HIT       → one synthetic `cached` step + the `evaluate` step
 *   - cross-user attach → one `attached` step + the `evaluate` step
 *   - MISS (full run) → `detail` + `search` (parent for parallel
 *                       `search.sold`/`search.active`) + `filter` + `evaluate`
 */

import type { EvaluateMeta, EvaluateResponse, MarketStats } from "@flipagent/types";
import type { ApiKey } from "../../db/schema.js";
import { parseItemId } from "../../utils/item-id.js";
import { fetchOrAwaitMarketData } from "./market-data.js";
import { EvaluateError, type PipelineListener } from "./pipeline.js";
import { scoreFromDigest } from "./score.js";
import type { EvaluateOptions } from "./types.js";

export type { PipelineEvent, PipelineListener, StepRequestInfo } from "./pipeline.js";
export { EvaluateError, wasEmittedAsStep } from "./pipeline.js";

/* --------------------------------- types --------------------------------- */

export interface RunEvaluateInput {
	itemId: string;
	lookbackDays?: number;
	soldLimit?: number;
	apiKey?: ApiKey;
	opts?: EvaluateOptions;
	onStep?: PipelineListener;
	/** Cooperative cancel — supplied by the compute-job dispatcher; throws `CancelledError` when the user cancelled. */
	cancelCheck?: () => Promise<void>;
	/**
	 * compute_jobs row id of the caller. Threaded into the upstream
	 * cache layer so cross-user in-flight lookups can exclude self,
	 * and so cache writes record an audit pointer back to the row that
	 * paid for the fetch.
	 */
	jobId?: string;
}

export type RunEvaluateResult = EvaluateResponse;

/* -------------------------------- pipeline -------------------------------- */

export async function runEvaluatePipeline(input: RunEvaluateInput): Promise<RunEvaluateResult> {
	const { itemId, lookbackDays = 90, soldLimit = 50, apiKey, opts, onStep, cancelCheck, jobId } = input;

	const parsed = parseItemId(itemId);
	if (!parsed) {
		throw new EvaluateError(
			"validation_failed",
			400,
			`Invalid itemId "${itemId}". Pass v1|<legacy>|<variationId>, the legacy numeric id, or a full eBay /itm/ URL.`,
		);
	}
	const { legacyId, variationId } = parsed;

	const digest = await fetchOrAwaitMarketData({
		itemId,
		legacyId,
		variationId,
		lookbackDays,
		soldLimit,
		apiKey,
		jobId,
		onStep,
		cancelCheck,
	});

	const { evaluation } = await scoreFromDigest({
		digest,
		opts,
		itemId,
		onStep,
		cancelCheck,
	});

	return {
		item: digest.item,
		evaluation,
		market: digest.market as MarketStats,
		sold: digest.sold,
		active: digest.active,
		filter: digest.filter,
		returns: digest.returns,
		meta: digest.meta as EvaluateMeta,
		// Back-compat: heavy pools still here for the playground dashboard.
		// MCP / SDK consumers should prefer `sold` + `active` digests and
		// `client.evaluate.pool(itemId)` for drill-down.
		soldPool: digest.matchedSold,
		activePool: digest.matchedActive,
		rejectedSoldPool: digest.rejectedSold,
		rejectedActivePool: digest.rejectedActive,
		rejectionReasons: digest.rejectionReasons,
		rejectionCategories: digest.rejectionCategories,
	} as EvaluateResponse;
}
