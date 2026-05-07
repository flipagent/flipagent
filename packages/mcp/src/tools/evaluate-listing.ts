/**
 * Evaluate is heavy server-side work (item detail fetch + sold/active
 * search + LLM same-product filter + scoring). P50 ~15–30s, P95 ~60s,
 * P99 ~2–3 min. Sync wait sits squarely in MCP's tool-timeout danger
 * zone (Claude Code ~60–120s), so the MCP surfaces evaluate as
 * **async + poll** — the same pattern Claude Code uses for long-running
 * shell commands and the same shape `flipagent_create_purchase` already
 * uses (jobId + `poll_with` metadata).
 *
 *   flipagent_evaluate_item            — POST /v1/evaluate/jobs (returns immediately)
 *   flipagent_get_evaluate_job         — GET  /v1/evaluate/jobs/{id} (polled)
 *   flipagent_get_evaluation_pool      — GET  /v1/evaluate/{itemId}/pool (drill-down)
 */

import { EvaluateRequest as EvaluateListingInputSchema, type EvaluateRequest } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";
import { uiResource } from "../ui-resource.js";

export { EvaluateListingInputSchema as evaluateListingInput };

export const evaluateListingDescription =
	'Score one listing as a flip opportunity (the headline decision tool). Calls POST /v1/evaluate/jobs. **Async** — heavy server-side work (detail fetch + sold/active search + LLM same-product filter + scoring) takes 10–60s typically, longer with scrape fallback. Returns **immediately** with a `jobId`; poll `flipagent_get_evaluate_job` until terminal. **When to use** — "should I buy this?" / "what should I bid?" / "what\'s a fair list price?". For batch screening, fire many of these in parallel — each returns a jobId immediately, then poll all jobs in parallel. **Inputs** — `itemId` (12-digit legacy, `v1|<n>|<v>` form, or full eBay URL — same grammar as `flipagent_create_purchase`). For multi-SKU listings (sneakers, sized clothing) include the variation. Optional `lookbackDays` (1–90, default 90), `soldLimit` (1–200, default 50), `opts.{forwarder, minNetCents, outboundShippingCents}`. **Output (immediate)** — `{ jobId, status: "queued", poll_with: "flipagent_get_evaluate_job", terminal_states: ["completed", "failed", "cancelled"] }`. **Polling** — wait ~5–10s, call `flipagent_get_evaluate_job(jobId)`, repeat until status is terminal. Typical evaluations finish in 10–30s; some take 60s+. **Cost** — 80 credits on submit (this call); polling and pool reads are free. **Prereqs** — `FLIPAGENT_API_KEY`; no eBay OAuth needed. **Example** — `{ itemId: "v1|234567890123|0", opts: { forwarder: { destState: "NY", weightG: 250 }, minNetCents: 1000 } }`.';

export async function evaluateListingExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const client = getClient(config);
	let jobId: string;
	try {
		const ack = await client.evaluate.jobs.create(args as unknown as EvaluateRequest);
		jobId = ack.id;
	} catch (err) {
		return toolErrorEnvelope(err, "evaluate_failed", "/v1/evaluate/jobs");
	}
	// One-shot long-poll inside the same tool call: collapse the
	// kickoff + polling dance into a single response so the model
	// doesn't have to "remember" to call `flipagent_get_evaluate_job`,
	// and the playground gets a populated EvaluatePanel directly.
	// Survivors of the 50s deadline come back with `status: "running"`
	// + jobId — the panel keeps its skeleton, and a follow-up
	// `flipagent_get_evaluate_job` call resumes the wait.
	return await pollEvaluateUntilTerminal(client, jobId);
}

/* ----------------- flipagent_get_evaluate_job (polling) ----------------- */

/**
 * Hybrid trim: keep the **matched** sold/active comp pools (lean per-item
 * essentials only) so an inline panel can render the histogram + comp
 * lists immediately, while dropping the **rejected** pools + reason
 * narratives — those are large (sometimes 100+ rows of LLM filter
 * narration) and rarely needed. Agents drill into rejected via
 * `flipagent_get_evaluation_pool` when explicitly asked.
 *
 * Per-item we keep only what the comp-list UI renders: id, title,
 * price/sold-price/bid-price, condition, image, web url, sold/end
 * date, buying options, bid count. Heavy fields (item specifics,
 * full seller blocks, location, shipping, image carousels) are
 * dropped — rows still link out via `itemWebUrl` for the user.
 */
function trimPoolItem(it: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	if (it.itemId != null) out.itemId = it.itemId;
	if (it.title != null) out.title = it.title;
	if (it.price != null) out.price = it.price;
	if (it.lastSoldPrice != null) out.lastSoldPrice = it.lastSoldPrice;
	if (it.currentBidPrice != null) out.currentBidPrice = it.currentBidPrice;
	if (typeof it.bidCount === "number") out.bidCount = it.bidCount;
	if (it.condition != null) out.condition = it.condition;
	if (it.conditionId != null) out.conditionId = it.conditionId;
	if (it.image != null) out.image = it.image;
	if (it.itemWebUrl != null) out.itemWebUrl = it.itemWebUrl;
	if (it.itemEndDate != null) out.itemEndDate = it.itemEndDate;
	if (it.lastSoldDate != null) out.lastSoldDate = it.lastSoldDate;
	if (Array.isArray(it.buyingOptions)) out.buyingOptions = it.buyingOptions;
	return out;
}

function trimPoolList(arr: unknown): unknown[] {
	if (!Array.isArray(arr)) return [];
	return arr.map((it) => (it && typeof it === "object" ? trimPoolItem(it as Record<string, unknown>) : it));
}

function trimToDigest(full: Record<string, unknown>): Record<string, unknown> {
	const {
		soldPool,
		activePool,
		rejectedSoldPool: _rejectedSoldPool,
		rejectedActivePool: _rejectedActivePool,
		rejectionReasons: _rejectionReasons,
		...rest
	} = full;
	return {
		...rest,
		...(Array.isArray(soldPool) ? { soldPool: trimPoolList(soldPool) } : {}),
		...(Array.isArray(activePool) ? { activePool: trimPoolList(activePool) } : {}),
	};
}

export const evaluateJobInput = Type.Object(
	{
		jobId: Type.String({
			format: "uuid",
			description: "Job id returned by `flipagent_evaluate_item`.",
		}),
	},
	{ $id: "EvaluateJobInput" },
);

export const evaluateJobDescription =
	'Poll an evaluation job until it reaches a terminal state. Calls GET /v1/evaluate/jobs/{id}. **When to use** — after `flipagent_evaluate_item` returned `{ jobId, status: "queued", poll_with: "flipagent_get_evaluate_job" }`, call this every ~5–10s until `status` is in `terminal_states`. **Inputs** — `jobId` (UUID from `flipagent_evaluate_item`). **Output (still running)** — `{ jobId, status: "queued" | "running", queuedAt, startedAt?, poll_with: "flipagent_get_evaluate_job" }`. Keep polling. **Output (completed)** — `{ jobId, status: "completed", queuedAt, completedAt, outcome: <digest> }`. The digest is `{ item, evaluation, market, sold, active, filter, returns, meta, soldPool, activePool }`. `evaluation` is the headline: `{ rating: "buy" | "skip", reason, successNetCents, expectedNetCents, maxLossCents, bidCeilingCents, safeBidBreakdown, netRangeCents, recommendedExit, risk }`. `successNetCents` is the gross net IF the sale goes through (happy path); `expectedNetCents` is the probabilistic E[net] = (1−P_fraud)·success − P_fraud·maxLoss (THE rating number); `maxLossCents` is the worst-case downside (return shipping if return-window-fits, else full buy). `risk` carries `{ P_fraud, withinReturnWindow, cycleDays, reason }`. `recommendedExit` is `{ listPriceCents, expectedDaysToSell, daysLow, daysHigh, netCents, dollarsPerDay, queueAhead, asksAbove }` — queue-based: `queueAhead` is the number of realistic asks at-or-below your price, `daysLow`/`daysHigh` are the ±σ Erlang band, `dollarsPerDay` is over the FULL buy→cash cycle (~11d overhead + sell-leg). `sold`/`active` digests carry distribution stats (`priceCents.{p10..p90}`, `priceHistogram`, `conditionMix`, `recentTrend`, `lastSale*` / `bestPriceCents`, `sellerConcentration`). `filter.rejectionsByCategory` counts rejections per category. `soldPool` / `activePool` carry the **matched** comps used to score the listing — lean rows: `{ itemId, title, price?, lastSoldPrice?, currentBidPrice?, bidCount?, condition?, image?, itemWebUrl, itemEndDate? | lastSoldDate?, buyingOptions? }`. **How to present to user (when completed)** — speak in pattern-level language using the stats; do NOT quote individual listings unless the user asks. Surface `evaluation.rating` + `reason` + `bidCeilingCents`, cite `sold.priceCents.p50` + IQR, `salesPerDay`, `recentTrend.direction`, and `filter.rejectionsByCategory` so the user can audit how the comp set was filtered. The digest answers ~95% of "why?" questions on its own. **Rejected pools** (filtered-out comps + per-item rejection reasons) are NOT included to keep context lean — call `flipagent_get_evaluation_pool({ itemId })` only when the user explicitly asks "show me what was rejected" / "what got filtered out". **Output (failed)** — `{ jobId, status: "failed", errorCode, errorMessage }`. Common: `variation_required` (multi-SKU listing — re-call `flipagent_evaluate_item` with `v1|<n>|<variation>`), `too_few_sold` (under N matches; try lower confidence or different `lookbackDays`), `item_not_found`. **Output (cancelled)** — `{ jobId, status: "cancelled" }`. Rare. **Cost** — free to poll (zero credits). **Prereqs** — `FLIPAGENT_API_KEY`. Job lives 7 days. **Example** — `{ jobId: "abcd1234-..." }`.';

export async function evaluateJobExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const jobId = String(args.jobId);
	try {
		const client = getClient(config);
		return await pollEvaluateUntilTerminal(client, jobId);
	} catch (err) {
		return toolErrorEnvelope(err, "get_evaluate_job_failed", `/v1/evaluate/jobs/${jobId}`);
	}
}

/**
 * Shared long-poll + UI rendering for evaluate jobs. Used by both
 * `flipagent_evaluate_item` (right after `jobs.create`) and
 * `flipagent_get_evaluate_job` (manual resume by id). Caps wait at
 * ~50s — survivors come back with `status: "running"` so the panel
 * keeps its skeleton + the agent can fire `flipagent_get_evaluate_job`
 * to continue.
 *
 * Always returns a uiResource (or a uiResource-shaped pending payload),
 * never raw fields — the playground's EvaluatePanel mounts off the
 * `ui.resourceUri` hint regardless of terminal state. That's what
 * makes the in-progress skeleton visible immediately after kickoff.
 *
 * On `429` while polling: returns a `rate_limited` uiResource so the
 * panel shows a Retry chip. `variation_required` results render a
 * variation picker. `completed` returns the trimmed digest.
 */
async function pollEvaluateUntilTerminal(client: ReturnType<typeof getClient>, jobId: string): Promise<unknown> {
	// 6s interval = ~9 GETs in 50s, well under the per-minute API rate
	// cap. The loop exits early on terminal status.
	const deadline = Date.now() + 50_000;
	const intervalMs = 6_000;
	const rateLimitedReturn = () =>
		uiResource({
			uri: "ui://flipagent/evaluate",
			structuredContent: {
				jobId,
				status: "rate_limited",
				errorCode: "rate_limited",
				errorMessage: "Rate-limit hit while polling; press Retry to fetch the result.",
			},
			summary:
				"Evaluation polling hit the per-minute rate limit. Result not fetched yet — the inline card carries a Retry button so the user can fire it again.",
		});

	let job: Awaited<ReturnType<typeof client.evaluate.jobs.get>>;
	try {
		job = await client.evaluate.jobs.get(jobId);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		if (/429|rate.?limit/i.test(msg)) return rateLimitedReturn();
		throw err;
	}
	while ((job.status === "queued" || job.status === "running") && Date.now() + intervalMs < deadline) {
		await new Promise((r) => setTimeout(r, intervalMs));
		try {
			job = await client.evaluate.jobs.get(jobId);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			if (/429|rate.?limit/i.test(msg)) return rateLimitedReturn();
			throw err;
		}
	}

	if (job.status === "queued" || job.status === "running") {
		// 50s deadline hit before terminal — surface the still-running job
		// as a uiResource so the playground's EvaluatePanel mounts the
		// pending skeleton with this jobId. Agent can call
		// `flipagent_get_evaluate_job` to resume waiting.
		return uiResource({
			uri: "ui://flipagent/evaluate",
			structuredContent: {
				jobId: job.id,
				status: job.status,
				queuedAt: job.createdAt,
				startedAt: job.startedAt ?? null,
				poll_with: "flipagent_get_evaluate_job",
				terminal_states: ["completed", "failed", "cancelled"],
			},
			summary: `Evaluation ${job.status} — call \`flipagent_get_evaluate_job\` with jobId ${job.id} to resume waiting.`,
		});
	}
	if (job.status !== "completed") {
		// `variation_required` is the most common failure on multi-SKU
		// listings — wrap it as a uiResource so the evaluate iframe can
		// render a variation picker the user clicks instead of asking
		// them to retype the variation id.
		const errorCode = job.errorCode ?? null;
		const details = (job as unknown as { errorDetails?: unknown }).errorDetails;
		if (errorCode === "variation_required" && details && typeof details === "object") {
			return uiResource({
				uri: "ui://flipagent/evaluate",
				structuredContent: {
					jobId: job.id,
					status: "variation_required",
					errorCode: "variation_required",
					errorMessage: job.errorMessage ?? null,
					details,
				},
				summary:
					"Multi-SKU listing — the inline card lists every variation; user clicks one to evaluate that exact SKU.",
			});
		}
		// Other terminal failures stay as a plain envelope — no UI panel
		// shape applies.
		return {
			jobId: job.id,
			status: job.status,
			queuedAt: job.createdAt,
			startedAt: job.startedAt ?? null,
			completedAt: job.completedAt ?? null,
			errorCode,
			errorMessage: job.errorMessage ?? null,
		};
	}

	// Completed — trim the heavy result and emit the success uiResource.
	const trimmed = job.result ? trimToDigest(job.result as unknown as Record<string, unknown>) : null;
	const evalBlock =
		trimmed && typeof trimmed === "object" ? (trimmed.evaluation as Record<string, unknown> | undefined) : undefined;
	const itemBlock =
		trimmed && typeof trimmed === "object" ? (trimmed.item as Record<string, unknown> | undefined) : undefined;
	const rating = evalBlock && typeof evalBlock.rating === "string" ? (evalBlock.rating as string) : "result";
	const titleSnippet =
		itemBlock && typeof itemBlock.title === "string" ? (itemBlock.title as string).slice(0, 60) : "";
	const summary = `Evaluation ${rating.toUpperCase()}${titleSnippet ? ` — "${titleSnippet}"` : ""}. Inline card shows the verdict + key stats; ask follow-ups or hit "See comps" for the rejected/kept pools.`;
	return uiResource({
		uri: "ui://flipagent/evaluate",
		// `outcome` (not `result`) — that's the field name the inline
		// `EvaluatePanel` reads to mark a run as terminal. With `result`,
		// the panel sees `props.outcome === undefined`, flips into
		// pending mode forever, and the user sees the
		// "Evaluation · running" skeleton even after the agent returned
		// a final verdict in chat. Align the two so the completed run
		// lights up the panel in place.
		structuredContent: {
			jobId: job.id,
			status: "completed",
			queuedAt: job.createdAt,
			completedAt: job.completedAt,
			outcome: trimmed,
		},
		summary,
	});
}

/* ----------------- flipagent_cancel_evaluate_job ----------------- */

export const evaluateCancelInput = Type.Object(
	{
		jobId: Type.String({
			format: "uuid",
			description: "Job id returned by `flipagent_evaluate_item`.",
		}),
	},
	{ $id: "EvaluateCancelInput" },
);

export const evaluateCancelDescription =
	'Request cooperative cancel for an in-flight evaluate job. Calls POST /v1/evaluate/jobs/{id}/cancel. **When to use** — you fired `flipagent_evaluate_item` and realised it was a duplicate / wrong itemId / variant before it finished, and want to release the worker slot. Idempotent — calling on a terminal job is a no-op. **Cost** — free; does NOT refund the submit charge (the usage event was already charged at `flipagent_evaluate_item` time, regardless of whether the pipeline runs to completion). The savings are in releasing the worker slot + skipping the rest of the run\'s scrape/LLM cost on the server side; the user-facing credit is already spent. **Cancel timing** — `queued` jobs flip to `cancelled` immediately; `running` jobs set `cancel_requested=true` and the worker tears down at the next pipeline step boundary (≤ a few seconds typically; mid-step IO like an eBay scrape or LLM call cannot be aborted). **Inputs** — `jobId` (UUID from `flipagent_evaluate_item`). **Output** — `{ id, status }` where status is the post-cancel state (`cancelled` if it transitioned, otherwise the current terminal state if too late). **Prereqs** — `FLIPAGENT_API_KEY`. **Example** — `{ jobId: "abcd1234-..." }`.';

export async function evaluateCancelExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const jobId = String(args.jobId);
	try {
		const client = getClient(config);
		return await client.evaluate.jobs.cancel(jobId);
	} catch (err) {
		return toolErrorEnvelope(err, "cancel_evaluate_job_failed", `/v1/evaluate/jobs/${jobId}/cancel`);
	}
}

/* ---------------- flipagent_get_evaluation_pool (drill-down) ---------------- */

export const evaluationPoolInput = Type.Object(
	{
		itemId: Type.String({
			minLength: 1,
			description:
				"Same itemId you passed to `flipagent_evaluate_item`. 12-digit legacy, `v1|<n>|<v>`, or full eBay URL — api normalizes.",
		}),
	},
	{ $id: "EvaluationPoolInput" },
);

export const evaluationPoolDescription =
	'Drill into the same-product pools used to score one listing. Calls GET /v1/evaluate/{itemId}/pool. **When to use** — only when the user explicitly asks to see *specific listings* beyond the default digest: "show me the rejected ones", "what did the actual sold comps look like", "are those active listings credible". The digest from `flipagent_get_evaluate_job` answers ~95% of "why?" questions on its own — call this only on explicit follow-up. **Inputs** — `itemId` (same grammar as `flipagent_evaluate_item`). **Output** — `{ itemId, evaluatedAt, sold: { kept[], rejected[] }, active: { kept[], rejected[] } }`. Each `kept` row: `{ itemId, title, priceCents, currency, condition?, sellerLogin?, itemWebUrl, soldAt? | listedAt? }`. Each `rejected` row adds `{ rejectionReason, rejectionCategory }` (categories: `wrong_product | bundle_or_lot | off_condition | other`). **Prereqs** — must call `flipagent_evaluate_item` first and let it complete, within the last ~24h on the same itemId. On cache miss returns 412 with `next_action` instructing to evaluate first. **Cost** — free read (zero credits, cache-only). **Example** — `{ itemId: "v1|234567890123|0" }`.';

export async function evaluationPoolExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const itemId = String(args.itemId);
	try {
		const client = getClient(config);
		return await client.evaluate.pool(itemId);
	} catch (err) {
		return toolErrorEnvelope(err, "get_evaluation_pool_failed", `/v1/evaluate/${itemId}/pool`);
	}
}
