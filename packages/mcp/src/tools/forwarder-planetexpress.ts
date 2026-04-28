/**
 * `planet_express_packages` — fetch the user's Planet Express inbox via
 * the bridge protocol. Same async pattern as eBay buy: queues a
 * `pull_packages` job, returns a `purchaseOrderId` (the bridge protocol
 * unifies job ids), agent polls `ebay_order_status` for completion.
 *
 * v1 skeleton: validates the multi-service architecture compiles end to
 * end. Real Planet Express DOM scraping is TBD; this tool's contract +
 * bridge dispatch + capability map all work today, so when the content
 * script's PE handler gets real selectors it lights up automatically.
 */

import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export const planetExpressPackagesInput = Type.Object({});

export const planetExpressPackagesDescription =
	"Read the user's Planet Express forwarder inbox (packages awaiting consolidation, on-hand, or shipped). Calls POST /v1/orders/checkout with `source: \"planetexpress\"` — the bridge protocol queues a `pull_packages` job and the user's flipagent Chrome extension reads the inbox from their logged-in PE session, then reports the package list back. Returns a `purchaseOrderId` immediately; poll `ebay_order_status` (despite the name — the surface is generic across services) until terminal. Requires the user to be signed into planetexpress.com in the same Chrome profile the extension is paired with.";

export async function planetExpressPackagesExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		// Bridge job piggybacks on the orders/checkout queue. itemId is
		// unused for forwarder reads but the CheckoutRequest schema
		// currently requires a non-empty string — pass a synthetic
		// constant; the PE content-script handler ignores it.
		// (Future: split into a dedicated /v1/forwarders/* surface so
		// service-specific args are properly typed.)
		return await client.orders.checkout({
			source: "planetexpress",
			itemId: "inbox",
		});
	} catch (err) {
		const e = toApiCallError(err, "/v1/orders/checkout");
		return {
			error: "planet_express_packages_failed",
			status: e.status,
			url: e.url,
			message: e.message,
			hint: "Sign into planetexpress.com in the Chrome profile your flipagent extension is paired with.",
		};
	}
}
