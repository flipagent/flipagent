import { ShipQuoteRequest as ShipQuoteInputSchema, type ShipQuoteRequest } from "@flipagent/types";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export { ShipQuoteInputSchema as shipQuoteInput };

export const shipQuoteDescription =
	"Compute total delivered cost via flipagent's forwarder. Calls POST /v1/ship/quote. Pass `item` (any /v1/items listing) and `forwarder` (`destState` US 2-letter, `weightG` grams, optional `dimsCm`, optional `provider`). Returns itemized breakdown plus forwarder ETA + caveats. US-domestic only; tax is 0 — destination-state sales tax is the caller's job.";

export async function shipQuoteExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const client = getClient(config);
	try {
		return await client.ship.quote(args as unknown as ShipQuoteRequest);
	} catch (err) {
		const e = toApiCallError(err, "/v1/ship/quote");
		return { error: "ship_quote_failed", status: e.status, message: e.message, url: e.url };
	}
}
