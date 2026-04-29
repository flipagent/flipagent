import { DraftRequest as DraftListingInputSchema, type DraftRequest } from "@flipagent/types";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export { DraftListingInputSchema as draftListingInput };

export const draftListingDescription =
	"Recommend optimal list price + title for a (re)listing. Calls POST /v1/draft. Pass `item` (the SKU you're listing — ItemSummary or ItemDetail) and `market` (from /v1/research/summary). Returns ListPriceRecommendation (`null` when the market lacks duration data — fall back to `market.medianCents`) plus a title suggestion to feed into PUT /v1/sell/inventory/inventory_item/{sku}.";

export async function draftListingExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const client = getClient(config);
	try {
		return await client.draft.listing(args as unknown as DraftRequest);
	} catch (err) {
		const e = toApiCallError(err, "/v1/draft");
		return { error: "draft_listing_failed", status: e.status, message: e.message, url: e.url };
	}
}
