import { EvaluateRequest as EvaluateListingInputSchema, type EvaluateRequest } from "@flipagent/types";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export { EvaluateListingInputSchema as evaluateListingInput };

export const evaluateListingDescription =
	"Score one listing as a flip opportunity. Calls POST /v1/evaluate. Pass `itemId` — accepts `v1|<n>|<variationId>`, `v1|<n>|0`, the legacy numeric id, or a full eBay URL like `https://www.ebay.com/itm/<n>?var=<v>`. For multi-SKU listings (sneakers, clothes, bags) include the variation so the right SKU's price + aspects drive the score; without it eBay default-renders one variation server-side. The server fetches the item detail, searches sold + active listings of the same product, runs the LLM same-product filter, and scores. Optional `opts.forwarder` attaches a US-domestic landed cost; `opts.minNetCents` / `opts.maxDaysToSell` set decision floors. Returns `{ item, soldPool, activePool, market, evaluation, meta }` — `evaluation` has rating buy/hold/skip + signals + recommendedExit; `meta` describes what was fetched (soldCount, activeCount, sources, kept/rejected counts). One usage event per call.";

export async function evaluateListingExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const client = getClient(config);
	try {
		return await client.evaluate.listing(args as unknown as EvaluateRequest);
	} catch (err) {
		const e = toApiCallError(err, "/v1/evaluate");
		return { error: "evaluate_listing_failed", status: e.status, message: e.message, url: e.url };
	}
}
