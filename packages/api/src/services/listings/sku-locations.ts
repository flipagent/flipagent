/**
 * SKU-level multi-warehouse location mapping. Wraps `/sell/inventory/v1/
 * listing/{listingId}/sku/{sku}/locations`. Lets a multi-variation listing
 * declare per-SKU stock at specific fulfillment-center merchantLocationKeys.
 *
 * eBay only considers the first 50 mapped locations when calculating EDD.
 */

import { sellRequest, swallow404 } from "../ebay/rest/user-client.js";

export interface SkuLocationsContext {
	apiKeyId: string;
}

export interface SkuLocationAvailability {
	merchantLocationKey: string;
	availability?: { quantity: number; allocationByFormat?: { auction?: number; fixedPrice?: number } };
}

interface UpstreamLocationMapping {
	locations?: SkuLocationAvailability[];
}

export async function getSkuLocations(
	listingId: string,
	sku: string,
	ctx: SkuLocationsContext,
): Promise<{ locations: SkuLocationAvailability[] } | null> {
	const res = await swallow404(
		sellRequest<UpstreamLocationMapping>({
			apiKeyId: ctx.apiKeyId,
			method: "GET",
			path: `/sell/inventory/v1/listing/${encodeURIComponent(listingId)}/sku/${encodeURIComponent(sku)}/locations`,
		}),
	);
	if (!res) return null;
	return { locations: res.locations ?? [] };
}

export async function setSkuLocations(
	listingId: string,
	sku: string,
	locations: SkuLocationAvailability[],
	ctx: SkuLocationsContext,
): Promise<{ ok: true }> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "PUT",
		path: `/sell/inventory/v1/listing/${encodeURIComponent(listingId)}/sku/${encodeURIComponent(sku)}/locations`,
		body: { locations },
		contentLanguage: "en-US",
	});
	return { ok: true };
}

export async function deleteSkuLocations(listingId: string, sku: string, ctx: SkuLocationsContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "DELETE",
		path: `/sell/inventory/v1/listing/${encodeURIComponent(listingId)}/sku/${encodeURIComponent(sku)}/locations`,
	});
}
