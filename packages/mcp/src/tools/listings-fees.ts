/**
 * Listing fee preview tool — backed by `/v1/listings/preview-fees`
 * (eBay Sell Inventory `POST /offer/get_listing_fees`).
 *
 * Operates on UNPUBLISHED offer drafts. For "estimate fees on a
 * hypothetical listing I haven't drafted yet", use
 * `flipagent_verify_listing` (Trading VerifyAddItem) instead.
 */

import { ListingPreviewFeesRequest } from "@flipagent/types";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

export { ListingPreviewFeesRequest as listingsPreviewFeesInput };

export const listingsPreviewFeesDescription =
	'Preview eBay fees for unpublished offer drafts. Calls POST /v1/listings/preview-fees. **When to use** — bulk pre-publish review: caller has already created N drafts (via `flipagent_create_listing` or the inventory APIs) and wants the marketplace fees before flipping the publish switch. **Inputs** — `{ offerIds: string[] }` (1–250 unpublished offerIds; published offers error with 25754). **Output** — `{ summaries: [{ marketplaceId, fees: [{ feeType, amount, promotionalDiscount? }], totalCents, warnings? }] }`. eBay groups fees by marketplace, NOT per-offer — the totals span all input offerIds publishing to that marketplace. **For pre-draft hypothetical fees** (no offerIds yet) call `flipagent_verify_listing` instead — Trading VerifyAddItem returns fees without needing a draft. **Prereqs** — eBay seller account connected. **Example** — `{ offerIds: ["OFR-12345", "OFR-67890"] }`.';

export async function listingsPreviewFeesExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.listings.previewFees(args as Parameters<typeof client.listings.previewFees>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "listings_preview_fees_failed", "/v1/listings/preview-fees");
	}
}
