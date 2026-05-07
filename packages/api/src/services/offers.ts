/**
 * sell/negotiation — outbound Best Offer (seller → watchers).
 */

import type { OfferCreate } from "@flipagent/types";
import { sellRequest, swallowEbay404 } from "./ebay/rest/user-client.js";
export interface OutboundContext {
	apiKeyId: string;
}

interface EligibleItem {
	listingId: string;
	availableQuantity?: number;
	soldQuantity?: number;
	watchCount?: number;
}

export async function findEligibleItems(ctx: OutboundContext): Promise<{ items: EligibleItem[]; total?: number }> {
	const res = await sellRequest<{
		eligibleItems?: Array<{
			listingId: string;
			availableQuantity?: number;
			soldQuantity?: number;
			watchCount?: number;
		}>;
		total?: number;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: "/sell/negotiation/v1/find_eligible_items",
	}).catch(swallowEbay404);
	return {
		items: res?.eligibleItems ?? [],
		...(res?.total !== undefined ? { total: res.total } : {}),
	};
}

export async function sendOfferToWatchers(
	input: OfferCreate,
	ctx: OutboundContext,
): Promise<{ offers: Array<{ id: string; listingId: string; status: string }> }> {
	const body: Record<string, unknown> = {
		offeredItems: [
			{
				listingId: input.listingId,
				discountPercentage: String(input.discountPercent),
				...(input.expiresIn !== undefined ? { duration: { value: input.expiresIn, unit: "HOUR" } } : {}),
			},
		],
		...(input.message ? { message: input.message } : {}),
		...(input.watchers ? { allowedBuyers: input.watchers.map((u) => ({ userId: u })) } : {}),
	};
	const res = await sellRequest<{
		offerSequenceId?: string;
		offerCreationStatus?: Array<{ listingId: string; offerCreationStatus?: string }>;
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/negotiation/v1/send_offer_to_interested_buyers",
		body,
		contentLanguage: "en-US",
	});
	return {
		offers: (res?.offerCreationStatus ?? []).map((o) => ({
			id: res?.offerSequenceId ?? "",
			listingId: o.listingId,
			status: o.offerCreationStatus ?? "PENDING",
		})),
	};
}
