/**
 * `/v1/listings/draft` — Sell Listing v1_beta `item_draft`. Creates a
 * pre-filled listing draft on eBay; seller finishes it by following
 * `listingRedirectUrl` on ebay.com. Useful for "give me a one-click
 * pre-filled listing" agent flows where the human reviews + publishes
 * the final price/inventory themselves.
 */

import type { ListingDraftRequest, ListingDraftResponse } from "@flipagent/types";
import { sellRequest } from "../ebay/rest/user-client.js";

export interface ListingDraftContext {
	apiKeyId: string;
	marketplace?: string;
}

export async function createListingDraft(
	input: ListingDraftRequest,
	ctx: ListingDraftContext,
): Promise<ListingDraftResponse> {
	const res = await sellRequest<{ itemDraftId?: string; listingRedirectUrl?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/listing/v1_beta/item_draft",
		body: (input.raw as Record<string, unknown>) ?? {},
		marketplace: ctx.marketplace ?? input.marketplace?.toUpperCase(),
		contentLanguage: "en-US",
	});
	return {
		itemDraftId: res?.itemDraftId ?? "",
		...(res?.listingRedirectUrl ? { listingRedirectUrl: res.listingRedirectUrl } : {}),
	};
}
