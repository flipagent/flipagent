/**
 * Pre-publish dry-run tool — backed by `/v1/listings/verify`
 * (eBay Trading `VerifyAddItem`).
 *
 * Replaces the older `flipagent_preview_listing_fees` MCP tool, which
 * called Sell Inventory `get_listing_fees` and required N existing
 * draft offer ids — useful for power-seller bulk batches but useless
 * to an agent that hasn't created any drafts yet. Verify takes the
 * same field shape as `flipagent_create_listing`, returns the eBay
 * fee total + the actual validation errors eBay would raise on
 * publish (missing aspects, invalid condition for category, return
 * policy gaps, etc.). The preview-fees REST + SDK paths stay live
 * for batch power users.
 */

import { ListingVerifyRequest } from "@flipagent/types";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

export { ListingVerifyRequest as listingsVerifyInput };

export const listingsVerifyDescription =
	'Dry-run a listing before creating it: returns eBay\'s fee estimate + the exact validation errors eBay would raise on publish. Calls POST /v1/listings/verify (Trading VerifyAddItem). **When to use** — pre-publish gate: estimate fees, catch missing aspects / wrong condition / missing return policy BEFORE you waste a `flipagent_create_listing` call (which goes through inventory_item → offer → publish and only fails at the last step). Run this with the user\'s draft data, surface the errors, then call create_listing once verify passes. **Inputs** — same shape as `flipagent_create_listing`: `title`, `price` ({value, currency}, cents-int), `categoryId` (from `flipagent_suggest_category`), `condition` (e.g. `used_excellent`), `images: string[]` (≥1 URL), optional `description`, `quantity` (default 1), `aspects` ({Brand: ["Apple"], …}), `duration` (default `GTC`). **Output** — `{ passed: boolean, fees?: { value, currency }, errors?: [{ code, message }], warnings?: [{ code, message }] }`. `passed=true` (Success or Warning) means eBay would accept the publish; `passed=false` means errors must be fixed first. Common errors: 21916250 missing return policy, 21919303 missing item-specific aspect, 21919136 photos required. **Prereqs** — eBay seller account connected. **Example** — `{ title: "Apple iPhone 12 mini 128GB White", price: { value: 39900, currency: "USD" }, categoryId: "9355", condition: "used_excellent", images: ["https://media.flipagent.dev/abc.jpg"], aspects: { Brand: ["Apple"], Model: ["iPhone 12 mini"], Color: ["White"], "Storage Capacity": ["128 GB"] } }`.';

export async function listingsVerifyExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.listings.verify(args as Parameters<typeof client.listings.verify>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "listings_verify_failed", "/v1/listings/verify");
	}
}
