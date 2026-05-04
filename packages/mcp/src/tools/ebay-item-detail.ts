import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";
import { mockItemDetail } from "../mock.js";

export const ebayItemDetailInput = Type.Object({
	itemId: Type.String(),
	status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("sold")])),
});

export const ebayItemDetailDescription =
	'Fetch full detail for a single marketplace listing. Calls GET /v1/items/{id}. **When to use** — drill into a candidate from `flipagent_search_items` to read aspects, full description, seller info, return policy, all photos, variations, and shipping options before evaluating or buying. **Inputs** — `itemId` (12-digit legacy id, `v1|<n>|<v>` form, or full `ebay.com/itm/...` URL — api normalizes); optional `status: "active" | "sold"` to read a sold record. **Output** — full `ItemDetail` (cents-int Money, ISO timestamps, marketplace-tagged) including `aspects`, `description`, `images[]`, `seller`, `shippingOptions`, `returns`, `variations`. **Prereqs** — `FLIPAGENT_API_KEY`; anonymous app token works (no eBay OAuth needed). **Example** — `{ itemId: "v1|234567890123|0" }`.';

export async function ebayItemDetailExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const itemId = String(args.itemId);
	if (config.mock) return mockItemDetail(itemId);
	try {
		const client = getClient(config);
		return await client.items.get(itemId, { status: args.status as "active" | "sold" | undefined });
	} catch (err) {
		return toolErrorEnvelope(err, "items_get_failed", `/v1/items/${itemId}`);
	}
}
