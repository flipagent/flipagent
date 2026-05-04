import { ShipQuoteRequest as ShipQuoteInputSchema, type ShipQuoteRequest } from "@flipagent/types";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

export { ShipQuoteInputSchema as shipQuoteInput };

export const shipQuoteDescription =
	'Compute total US-domestic landed cost for an item using a flipagent-supported forwarder. Calls POST /v1/ship/quote. **When to use** — answer "what does it actually cost to ship this to the buyer?" — typically right after `flipagent_evaluate_item` when you want to plug landed cost into a margin estimate, or in response to a buyer asking about postage. **Inputs** — `item` (any `/v1/items` listing object — pass through whole, the api reads weight + dims), `forwarder` (`destState` US 2-letter, `weightG` grams, optional `dimsCm`, optional `provider` from `flipagent_list_shipping_providers`). **Output** — `{ totalCents, breakdown: { forwarderHandlingCents, carrierCents, fuelCents, ... }, transitDays, caveats[] }`. **Prereqs** — `FLIPAGENT_API_KEY`; no eBay OAuth needed. US-domestic only — tax is 0 in the response, destination-state sales tax is the caller\'s responsibility. **Example** — `{ item: { ...evaluatedItem }, forwarder: { destState: "NY", weightG: 250 } }`.';

export async function shipQuoteExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const client = getClient(config);
	try {
		return await client.ship.quote(args as unknown as ShipQuoteRequest);
	} catch (err) {
		return toolErrorEnvelope(err, "ship_quote_failed", "/v1/ship/quote");
	}
}
