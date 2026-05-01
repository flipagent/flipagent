/**
 * `/v1/evaluate` pipeline. id-driven; the seed is the user-supplied
 * itemId. Four logical steps; step 2 (search) fans out into two
 * parallel children:
 *
 *   1. detail              — getItemDetail(itemId)
 *   2. search              (parent)
 *      ├─ search.sold      — searchSoldListings(detail.title)
 *      └─ search.active    — searchActiveListings(detail.title)
 *      Children run via Promise.allSettled — one failure doesn't block
 *      the other, and the trace surfaces both outcomes independently.
 *   3. filter              — LLM same-product filter (combined pool, one call)
 *   4. evaluate            — quant scoring, recommended exit
 *
 * Backed by `runEvaluatePipeline`. Routes call this with or without an
 * `onStep` listener — collapsed JSON ignores the events, SSE writes
 * each one to the client. Pipeline shape is identical either way.
 */

import type { EvaluateMeta, EvaluateResponse, MarketStats, TransportSource } from "@flipagent/types";
import type { ApiKey } from "../../db/schema.js";
import { legacyFromV1 } from "../../utils/item-id.js";
import { getItemDetail } from "../listings/detail.js";
import { searchActiveListings } from "../listings/search.js";
import { searchSoldListings } from "../listings/sold.js";
import { marketFromSold } from "./adapter.js";
import { evaluateWithContext } from "./evaluate-with-context.js";
import { buildPath, EvaluateError, runMatchFilter, type StepListener, withStep } from "./pipeline.js";
import { extractReturns } from "./returns.js";
import type { EvaluateOptions } from "./types.js";

export type { StepEvent, StepListener, StepRequestInfo } from "./pipeline.js";
export { EvaluateError, wasEmittedAsStep } from "./pipeline.js";

/* --------------------------------- types --------------------------------- */

export interface RunEvaluateInput {
	itemId: string;
	lookbackDays?: number;
	soldLimit?: number;
	apiKey?: ApiKey;
	opts?: EvaluateOptions;
	onStep?: StepListener;
	/** Cooperative cancel — supplied by the compute-job dispatcher; throws `CancelledError` when the user cancelled. */
	cancelCheck?: () => Promise<void>;
}

/**
 * Pipeline result == the wire `EvaluateResponse` shape, by design. Type
 * aliasing keeps `EvaluateResponse` (TypeBox-derived) and the route's
 * `c.json(result)` body in lockstep — any drift fails compile.
 */
export type RunEvaluateResult = EvaluateResponse;

const LABELS = {
	detail: "Look up listing",
	"search.sold": "Recent sales",
	"search.active": "Active competition",
	filter: "Filter same product",
	evaluate: "Evaluate",
} as const;

/* -------------------------------- pipeline -------------------------------- */

export async function runEvaluatePipeline(input: RunEvaluateInput): Promise<RunEvaluateResult> {
	const { itemId, lookbackDays = 90, soldLimit = 50, apiKey, opts, onStep, cancelCheck } = input;

	const legacyId = legacyFromV1(itemId);
	if (!legacyId) {
		throw new EvaluateError(
			"validation_failed",
			400,
			`Invalid itemId "${itemId}". Pass v1|<legacy>|0 or the legacy numeric id.`,
		);
	}

	// 1. detail ----------------------------------------------------------
	const detail = await withStep(
		{
			key: "detail",
			label: LABELS.detail,
			request: { method: "GET", path: `/v1/buy/browse/item/${encodeURIComponent(itemId)}` },
			onStep,
			cancelCheck,
		},
		async () => {
			const detailResult = await getItemDetail(legacyId, { apiKey });
			if (!detailResult) throw new EvaluateError("item_not_found", 404, `No detail found for "${itemId}".`);
			if (!detailResult.body.title?.trim()) {
				throw new EvaluateError("no_title", 422, `Item "${itemId}" has no title.`);
			}
			return {
				value: detailResult,
				result: detailResult.body,
				source: detailResult.source as TransportSource,
			};
		},
	);

	// 2. search (parallel) ----------------------------------------------
	const q = detail.body.title.trim();
	const since = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
	const lookbackFilter = `lastSoldDate:[${since}..]`;

	if (cancelCheck) await cancelCheck();
	// `search.sold` + `search.active` are two parallel calls — group them
	// under a synthetic `search` parent so the trace UI stacks them as
	// children with the shared vertical guide line. Without the parent,
	// two consecutive top-level rows ("02 Recent sales", "03 Active
	// competition") read as sequential even though they ran in parallel.
	onStep?.({ kind: "started", key: "search", label: "Search market" });
	const searchStart = performance.now();
	const [soldSettled, activeSettled] = await Promise.allSettled([
		withStep(
			{
				key: "search.sold",
				label: LABELS["search.sold"],
				parent: "search",
				request: {
					method: "GET",
					path: buildPath("/v1/buy/marketplace_insights/item_sales/search", {
						q,
						limit: soldLimit,
						filter: lookbackFilter,
					}),
				},
				onStep,
				cancelCheck,
			},
			async () => {
				const r = await searchSoldListings({ q, limit: soldLimit, filter: lookbackFilter }, { apiKey });
				const items = r.body.itemSales ?? r.body.itemSummaries ?? [];
				return {
					value: { items, source: r.source as TransportSource },
					result: { count: items.length, items },
					source: r.source as TransportSource,
				};
			},
		),
		withStep(
			{
				key: "search.active",
				label: LABELS["search.active"],
				parent: "search",
				request: {
					method: "GET",
					path: buildPath("/v1/buy/browse/item_summary/search", { q, limit: 50 }),
				},
				onStep,
				cancelCheck,
			},
			async () => {
				const r = await searchActiveListings({ q, limit: 50 }, { apiKey });
				const items = r.body.itemSummaries ?? [];
				return {
					value: { items, source: r.source as TransportSource },
					result: { count: items.length, items },
					source: r.source as TransportSource,
				};
			},
		),
	]);
	const searchDurationMs = Math.round(performance.now() - searchStart);
	// Real upstream failure on either leg short-circuits the pipeline.
	// Silently degrading to `[]` masked vendor breakage (e.g. scraper 401,
	// eBay 5xx) as a downstream `not_enough_sold`, which sent users
	// hunting for their item instead of for the outage. A genuinely empty
	// result set still flows through with `[]` and surfaces as
	// `nObservations: 0` from `evaluate()`.
	for (const settled of [soldSettled, activeSettled] as const) {
		if (settled.status === "rejected") {
			const message = String((settled.reason as Error)?.message ?? settled.reason);
			onStep?.({ kind: "failed", key: "search", error: message, durationMs: searchDurationMs });
			const aborted = new EvaluateError("search_failed", 502, message);
			(aborted as { __stepEmitted?: true }).__stepEmitted = true;
			throw aborted;
		}
	}
	const soldPool = soldSettled.status === "fulfilled" ? soldSettled.value.items : [];
	const soldSource = soldSettled.status === "fulfilled" ? soldSettled.value.source : null;
	const activePool = activeSettled.status === "fulfilled" ? activeSettled.value.items : [];
	const activeSource = activeSettled.status === "fulfilled" ? activeSettled.value.source : null;
	onStep?.({
		kind: "succeeded",
		key: "search",
		result: { soldCount: soldPool.length, activeCount: activePool.length },
		durationMs: searchDurationMs,
	});

	// 3. filter ----------------------------------------------------------
	const filtered = await withStep({ key: "filter", label: LABELS.filter, onStep, cancelCheck }, async () => {
		const f = await runMatchFilter(detail.body, soldPool, activePool, apiKey);
		return {
			value: f,
			result: {
				llmRan: f.llmRan,
				soldKept: f.matchedSold.length,
				soldRejected: f.rejectedSold.length,
				activeKept: f.matchedActive.length,
				activeRejected: f.rejectedActive.length,
			},
		};
	});

	// Genuine 0-match is a normal evaluate result, not an error: the
	// downstream `evaluate()` already gates distribution math on
	// `MIN_SOLD_FOR_DISTRIBUTION` and emits `nObservations: 0` with a
	// shaped result the UI can label as "no recent sales". Throwing
	// here used to throw the rest of the work away (item detail, active
	// competition, asks distribution) for what is just a confidence
	// signal.

	// 4. evaluate -------------------------------------------------------
	// `marketFromSold` reads `itemCreationDate` / `itemEndDate` directly
	// off the matched sold ItemSummary — `matchPoolWithLlm` (services/
	// match/matcher) fetches detail for every triage survivor as part of
	// its enrichment pass and splices the date fields back onto the
	// summary. So a separate `sold.details` step here would just
	// duplicate work the matcher already did (and always does, even when
	// the (candidate, item) match-decision cache short-circuits the
	// LLM verify).
	const { evaluation, market } = await withStep(
		{
			key: "evaluate",
			label: LABELS.evaluate,
			request: { method: "POST", path: "/v1/evaluate", body: { itemId, opts } },
			onStep,
			cancelCheck,
		},
		async () => {
			const ev = await evaluateWithContext(detail.body, {
				...opts,
				sold: filtered.matchedSold,
				asks: filtered.matchedActive,
			});
			const m = marketFromSold(
				filtered.matchedSold,
				undefined,
				undefined,
				filtered.matchedActive,
			) as unknown as MarketStats;
			return { value: { evaluation: ev, market: m }, result: { evaluation: ev, market: m } };
		},
	);

	const meta: EvaluateMeta = {
		itemSource: detail.source as TransportSource,
		soldCount: filtered.matchedSold.length,
		soldSource,
		activeCount: filtered.matchedActive.length,
		activeSource,
		soldKept: filtered.matchedSold.length,
		soldRejected: filtered.rejectedSold.length,
		activeKept: filtered.matchedActive.length,
		activeRejected: filtered.rejectedActive.length,
	};

	return {
		item: detail.body,
		soldPool: filtered.matchedSold,
		activePool: filtered.matchedActive,
		rejectedSoldPool: filtered.rejectedSold,
		rejectedActivePool: filtered.rejectedActive,
		market,
		evaluation,
		returns: extractReturns(detail.body),
		meta,
	};
}
