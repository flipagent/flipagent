/**
 * `client.match` — comparable curation. Server-side two-pass LLM matcher
 * that classifies each pool listing as the same product as the
 * candidate or not. Strict — different model, finish, colour,
 * condition, or missing accessories all become `reject`.
 *
 * The host picks the LLM provider via env (Anthropic / OpenAI /
 * Google) — clients see the same response shape either way.
 *
 * Recommended sequence:
 *
 *   const pool = await client.sold.search({ q });
 *   const buckets = await client.match.pool({
 *     candidate,
 *     pool: pool.itemSales ?? [],
 *   });
 *   const comparables = buckets.match.map((m) => m.item);
 *   const evaluation = await client.evaluate.listing({
 *     item: candidate,
 *     opts: { comparables },
 *   });
 *
 * `options.useImages` (default true) controls whether the matcher
 * inspects listing images. Disable for cheaper / faster runs.
 */

import type {
	MatchDelegateResponse,
	MatchRequest,
	MatchResponse,
	MatchTraceRequest,
	MatchTraceResponse,
} from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

/**
 * Result of `pool()`. Discriminate on the `mode` field of the
 * delegate variant — hosted responses don't carry one.
 */
export type MatchPoolResult = MatchResponse | MatchDelegateResponse;

export function isDelegateResponse(r: MatchPoolResult): r is MatchDelegateResponse {
	return (r as MatchDelegateResponse).mode === "delegate";
}

export interface MatchClient {
	/**
	 * Bucket pool items as match / reject against a candidate.
	 *
	 * - Default (`options.mode === "hosted"` or omitted): the server
	 *   runs its two-pass LLM matcher and returns `MatchResponse`.
	 *
	 * - With `options.mode === "delegate"`: the server returns a
	 *   ready-to-run prompt + JSON schema (`MatchDelegateResponse`).
	 *   The caller's own LLM does the inference. Use
	 *   `isDelegateResponse(res)` to narrow the type.
	 */
	pool(req: MatchRequest): Promise<MatchPoolResult>;
	/**
	 * Post the host LLM's decisions back to flipagent for calibration.
	 * Anonymous — no API-key → trace link is stored. The SDK does NOT
	 * automatically call this; the caller decides whether to honour
	 * the user's telemetry preference (`FLIPAGENT_TELEMETRY=0`) and
	 * whether to upload at all.
	 */
	trace(req: MatchTraceRequest): Promise<MatchTraceResponse>;
}

export function createMatchClient(http: FlipagentHttp): MatchClient {
	return {
		pool: (req) => http.post<MatchPoolResult>("/v1/match", req),
		trace: (req) => http.post<MatchTraceResponse>("/v1/traces/match", req),
	};
}
