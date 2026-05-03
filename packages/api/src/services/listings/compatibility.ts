/**
 * Inventory item product-compatibility CRUD — for parts/motors
 * listings (e.g. "fits 2018-2022 Honda Civic"). One inventory_item
 * gets a list of compatibility rows, each row a record of property
 * → value pairs (Year, Make, Model, etc).
 *
 * Wraps `/sell/inventory/v1/inventory_item/{sku}/product_compatibility`.
 */

import { sellRequest, swallow404 } from "../ebay/rest/user-client.js";

export interface CompatibilityContext {
	apiKeyId: string;
}

export interface CompatibilityProperty {
	name: string;
	value: string;
}

export interface CompatibilityRow {
	productFamilyProperties?: Record<string, string>;
	properties: CompatibilityProperty[];
	notes?: string;
}

interface UpstreamProperty {
	name?: string;
	value?: string;
}

interface UpstreamCompatibility {
	productFamilyProperties?: Record<string, string>;
	productIdentifier?: { gtin?: string; epid?: string };
	properties?: UpstreamProperty[];
	notes?: string;
}

interface UpstreamCompatibilityResponse {
	compatibleProducts?: UpstreamCompatibility[];
}

function toRow(c: UpstreamCompatibility): CompatibilityRow {
	return {
		...(c.productFamilyProperties ? { productFamilyProperties: c.productFamilyProperties } : {}),
		properties: (c.properties ?? []).map((p) => ({ name: p.name ?? "", value: p.value ?? "" })),
		...(c.notes ? { notes: c.notes } : {}),
	};
}

export async function getProductCompatibility(
	sku: string,
	ctx: CompatibilityContext,
): Promise<{ compatibleProducts: CompatibilityRow[] } | null> {
	const res = await swallow404(
		sellRequest<UpstreamCompatibilityResponse>({
			apiKeyId: ctx.apiKeyId,
			method: "GET",
			path: `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}/product_compatibility`,
		}),
	);
	if (!res) return null;
	return { compatibleProducts: (res.compatibleProducts ?? []).map(toRow) };
}

export async function setProductCompatibility(
	sku: string,
	compatibleProducts: CompatibilityRow[],
	ctx: CompatibilityContext,
): Promise<{ ok: true }> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "PUT",
		path: `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}/product_compatibility`,
		body: {
			compatibleProducts: compatibleProducts.map((c) => ({
				...(c.productFamilyProperties ? { productFamilyProperties: c.productFamilyProperties } : {}),
				properties: c.properties,
				...(c.notes ? { notes: c.notes } : {}),
			})),
		},
		contentLanguage: "en-US",
	});
	return { ok: true };
}

export async function deleteProductCompatibility(sku: string, ctx: CompatibilityContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "DELETE",
		path: `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}/product_compatibility`,
	});
}
