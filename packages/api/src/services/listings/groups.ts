/**
 * Inventory item-group bulk publish / withdraw — operates on a group
 * of variant offers (multi-variation listings) in one call. Distinct
 * from `bulk_publish_offer` which takes an explicit list of offerIds;
 * here you publish/withdraw all variants under one item-group key.
 *
 * Wraps `/sell/inventory/v1/offer/{publish,withdraw}_by_inventory_item_group`.
 */

import { sellRequest } from "../ebay/rest/user-client.js";

export interface ItemGroupContext {
	apiKeyId: string;
	marketplace?: string;
}

interface PublishByGroupResponse {
	listingId?: string;
	warnings?: Array<{ message?: string; longMessage?: string; errorId?: number }>;
}

export async function publishByInventoryItemGroup(
	inventoryItemGroupKey: string,
	marketplaceId: string,
	ctx: ItemGroupContext,
): Promise<{ listingId: string | null; warnings: Array<{ message: string; errorId?: number }> }> {
	const res = await sellRequest<PublishByGroupResponse>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/inventory/v1/offer/publish_by_inventory_item_group",
		body: { inventoryItemGroupKey, marketplaceId },
		marketplace: ctx.marketplace,
	});
	return {
		listingId: res?.listingId ?? null,
		warnings: (res?.warnings ?? []).map((w) => ({
			message: w.longMessage ?? w.message ?? "Unknown warning",
			...(w.errorId != null ? { errorId: w.errorId } : {}),
		})),
	};
}

export async function withdrawByInventoryItemGroup(
	inventoryItemGroupKey: string,
	marketplaceId: string,
	ctx: ItemGroupContext,
): Promise<{ ok: true }> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/inventory/v1/offer/withdraw_by_inventory_item_group",
		body: { inventoryItemGroupKey, marketplaceId },
		marketplace: ctx.marketplace,
	});
	return { ok: true };
}
