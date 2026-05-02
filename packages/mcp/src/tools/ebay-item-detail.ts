import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";
import { mockItemDetail } from "../mock.js";

export const ebayItemDetailInput = Type.Object({
	itemId: Type.String(),
	status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("sold")])),
});

export const ebayItemDetailDescription =
	"Fetch full detail for a marketplace listing. Calls GET /v1/items/{id}. Accepts bare numeric, v1|...|0, or full eBay URL. Returns normalized `Item` (cents-int Money, ISO timestamps).";

export async function ebayItemDetailExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const itemId = String(args.itemId);
	if (config.mock) return mockItemDetail(itemId);
	try {
		const client = getClient(config);
		return await client.items.get(itemId, { status: args.status as "active" | "sold" | undefined });
	} catch (err) {
		const e = toApiCallError(err, `/v1/items/${itemId}`);
		return { error: "listings_get_failed", status: e.status, message: e.message, url: e.url };
	}
}
