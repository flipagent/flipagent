import { RepriceRequest as RepriceListingInputSchema, type RepriceRequest } from "@flipagent/types";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export { RepriceListingInputSchema as repriceListingInput };

export const repriceListingDescription =
	"Decide hold/drop/delist for a sitting listing. Calls POST /v1/reprice. Pass `market` (from /v1/research/thesis) and `state` (`currentPriceCents` + `listedAt` ISO date-time). Compares time elapsed against expected time-to-sell. Returns `action` (hold | drop | delist) with a `suggestedPriceCents` when dropping. Defaults to 'hold' when the market lacks duration data.";

export async function repriceListingExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const client = getClient(config);
	try {
		return await client.reprice.listing(args as unknown as RepriceRequest);
	} catch (err) {
		const e = toApiCallError(err, "/v1/reprice");
		return { error: "reprice_listing_failed", status: e.status, message: e.message, url: e.url };
	}
}
