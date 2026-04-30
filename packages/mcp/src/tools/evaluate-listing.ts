import { EvaluateRequest as EvaluateListingInputSchema, type EvaluateRequest } from "@flipagent/types";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export { EvaluateListingInputSchema as evaluateListingInput };

export const evaluateListingDescription =
	"Score one listing as a flip opportunity. Calls POST /v1/evaluate. Pass `itemId` (`v1|...|0` from a Browse search, or the legacy numeric id) — the server fetches the item detail, searches sold + active listings of the same product, runs the LLM same-product filter, and scores. Optional `opts.forwarder` attaches a US-domestic landed cost; `opts.minNetCents` / `opts.maxDaysToSell` set decision floors. Returns `{ item, soldPool, activePool, market, evaluation, meta }` — `evaluation` has rating buy/hold/skip + signals + recommendedExit; `meta` describes what was fetched (soldCount, activeCount, sources, kept/rejected counts). One usage event per call.";

export async function evaluateListingExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const client = getClient(config);
	try {
		return await client.evaluate.listing(args as unknown as EvaluateRequest);
	} catch (err) {
		const e = toApiCallError(err, "/v1/evaluate");
		return { error: "evaluate_listing_failed", status: e.status, message: e.message, url: e.url };
	}
}
