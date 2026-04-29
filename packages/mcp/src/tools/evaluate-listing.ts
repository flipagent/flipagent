import { EvaluateRequest as EvaluateListingInputSchema, type EvaluateRequest } from "@flipagent/types";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export { EvaluateListingInputSchema as evaluateListingInput };

export const evaluateListingDescription =
	"Score one listing as a flip opportunity. Calls POST /v1/evaluate. Pass `item` (ItemSummary or ItemDetail from /v1/buy/browse/*) and `opts.comparables` (sold listings from /v1/buy/marketplace_insights/item_sales/search) for margin math; add `opts.forwarder` to attach a US-domestic landed cost. Returns Evaluation with rating buy/hold/skip plus signals fired.";

export async function evaluateListingExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const client = getClient(config);
	try {
		return await client.evaluate.listing(args as unknown as EvaluateRequest);
	} catch (err) {
		const e = toApiCallError(err, "/v1/evaluate");
		return { error: "evaluate_listing_failed", status: e.status, message: e.message, url: e.url };
	}
}
