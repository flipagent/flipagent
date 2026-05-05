/**
 * sell/metadata read ops — per-marketplace return-policy options +
 * sales-tax jurisdictions.
 */

import type { MarketplaceMetadata, ReturnPolicyOption, SalesTaxJurisdiction } from "@flipagent/types";
import { sellRequest } from "../ebay/rest/user-client.js";

const COUNTRY_TO_EBAY: Record<string, string> = {
	US: "EBAY_US",
	GB: "EBAY_GB",
	DE: "EBAY_DE",
	AU: "EBAY_AU",
	CA: "EBAY_CA",
	FR: "EBAY_FR",
	IT: "EBAY_IT",
	ES: "EBAY_ES",
	JP: "EBAY_JP",
};

interface EbayReturnPolicies {
	returnPolicies?: Array<{
		categoryTypes?: Array<{ categoryTreeId?: string; categoryId?: string }>;
		returnsAcceptedValues?: Array<{ value: boolean }>;
		returnPeriodValues?: Array<{ value: number; unit: string }>;
		returnMethodValues?: Array<{ value: string }>;
		refundMethodValues?: Array<{ value: string }>;
		returnShippingCostPayerValues?: Array<{ value: string }>;
	}>;
}

interface EbaySalesTax {
	salesTaxJurisdictions?: Array<{
		salesTaxJurisdictionId: string;
		salesTaxJurisdictionName: string;
	}>;
}

export interface MarketplaceMetaContext {
	apiKeyId: string;
}

/**
 * Generic per-marketplace metadata read. eBay exposes 17 different
 * `/sell/metadata/v1/marketplace/{m}/get_*_policies` endpoints — they
 * all share the same `(marketplace, kind)` shape; this helper avoids
 * defining 17 near-identical typed wrappers. Caller picks the kind
 * from the documented enum and gets back eBay's raw response.
 *
 * Verified live 2026-05-03: `get_return_policies`, `get_listing_structure_policies`,
 * `get_currencies`, `get_extended_producer_responsibility_policies`,
 * `get_hazardous_materials_labels`, `get_motors_listing_policies` (with
 * filter), `get_negotiated_price_policies` all return 200; the older
 * `get_payment_policies` and `get_product_adoption_policies` 404 (eBay
 * removed them).
 */
export type MarketplacePolicyKind =
	| "automotive_parts_compatibility"
	| "category"
	| "classified_ad"
	| "currencies"
	| "extended_producer_responsibility"
	| "hazardous_materials_labels"
	| "item_condition"
	| "listing_structure"
	| "listing_type"
	| "motors_listing"
	| "negotiated_price"
	| "product_safety_labels"
	| "regulatory"
	| "return"
	| "shipping"
	| "site_visibility";

const KIND_TO_PATH: Record<MarketplacePolicyKind, string> = {
	automotive_parts_compatibility: "get_automotive_parts_compatibility_policies",
	category: "get_category_policies",
	classified_ad: "get_classified_ad_policies",
	currencies: "get_currencies",
	extended_producer_responsibility: "get_extended_producer_responsibility_policies",
	hazardous_materials_labels: "get_hazardous_materials_labels",
	item_condition: "get_item_condition_policies",
	listing_structure: "get_listing_structure_policies",
	listing_type: "get_listing_type_policies",
	motors_listing: "get_motors_listing_policies",
	negotiated_price: "get_negotiated_price_policies",
	product_safety_labels: "get_product_safety_labels",
	regulatory: "get_regulatory_policies",
	return: "get_return_policies",
	shipping: "get_shipping_policies",
	site_visibility: "get_site_visibility_policies",
};

export async function getMarketplacePolicy(
	kind: MarketplacePolicyKind,
	marketplace: string,
	ctx: MarketplaceMetaContext,
	filter?: string,
): Promise<unknown> {
	const path = `/sell/metadata/v1/marketplace/${encodeURIComponent(marketplace)}/${KIND_TO_PATH[kind]}${filter ? `?filter=${encodeURIComponent(filter)}` : ""}`;
	return await sellRequest({ apiKeyId: ctx.apiKeyId, method: "GET", path }).catch(() => null);
}

/* ============================================================ Compatibilities — POST helpers */

/**
 * Cross-category compatibility lookup helpers. Each takes a body of
 * compatibility-property name/value pairs and returns matching products
 * or property metadata. Used by the listing-create flow to validate
 * "fits 2020 Toyota Corolla"-style aspects before publishing.
 */
export async function getCompatibilitiesBySpecification(
	body: Record<string, unknown>,
	ctx: MarketplaceMetaContext,
	marketplace: string,
): Promise<unknown> {
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/metadata/v1/compatibilities/get_compatibilities_by_specification",
		body,
		marketplace,
	}).catch(() => null);
}

export async function getCompatibilityPropertyNames(
	body: Record<string, unknown>,
	ctx: MarketplaceMetaContext,
	marketplace: string,
): Promise<unknown> {
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/metadata/v1/compatibilities/get_compatibility_property_names",
		body,
		marketplace,
	}).catch(() => null);
}

export async function getCompatibilityPropertyValues(
	body: Record<string, unknown>,
	ctx: MarketplaceMetaContext,
	marketplace: string,
): Promise<unknown> {
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/metadata/v1/compatibilities/get_compatibility_property_values",
		body,
		marketplace,
	}).catch(() => null);
}

export async function getMultiCompatibilityPropertyValues(
	body: Record<string, unknown>,
	ctx: MarketplaceMetaContext,
	marketplace: string,
): Promise<unknown> {
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/metadata/v1/compatibilities/get_multi_compatibility_property_values",
		body,
		marketplace,
	}).catch(() => null);
}

export async function getProductCompatibilities(
	body: Record<string, unknown>,
	ctx: MarketplaceMetaContext,
	marketplace: string,
): Promise<unknown> {
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/metadata/v1/compatibilities/get_product_compatibilities",
		body,
		marketplace,
	}).catch(() => null);
}

export async function getMarketplaceMetadata(
	country: string,
	ctx: MarketplaceMetaContext,
): Promise<MarketplaceMetadata> {
	const ebayMarketplace = COUNTRY_TO_EBAY[country.toUpperCase()] ?? "EBAY_US";
	// Sales tax jurisdictions are keyed by COUNTRY (not marketplace) on
	// the eBay side. Verified live 2026-05-02: the
	// `/marketplace/{X}/get_sales_tax_jurisdictions` form 404s — only
	// `/country/{cc}/sales_tax_jurisdiction` (singular, no `get_` prefix)
	// works.
	const countryCode = country.toUpperCase();
	const [returnRes, salesRes] = await Promise.all([
		sellRequest<EbayReturnPolicies>({
			apiKeyId: ctx.apiKeyId,
			method: "GET",
			path: `/sell/metadata/v1/marketplace/${encodeURIComponent(ebayMarketplace)}/get_return_policies`,
		}).catch(() => ({ returnPolicies: [] })),
		sellRequest<EbaySalesTax>({
			apiKeyId: ctx.apiKeyId,
			method: "GET",
			path: `/sell/metadata/v1/country/${encodeURIComponent(countryCode)}/sales_tax_jurisdiction`,
		}).catch(() => ({ salesTaxJurisdictions: [] })),
	]);

	const returnPolicies: ReturnPolicyOption[] = (returnRes?.returnPolicies ?? []).map((rp) => ({
		returnsAcceptedValues: (rp.returnsAcceptedValues ?? []).map((v) => v.value),
		returnPeriodValues: (rp.returnPeriodValues ?? []).map((v) => ({ value: v.value, unit: v.unit })),
		...(rp.returnMethodValues ? { returnMethodValues: rp.returnMethodValues.map((v) => v.value) } : {}),
		...(rp.refundMethodValues ? { refundMethodValues: rp.refundMethodValues.map((v) => v.value) } : {}),
		...(rp.returnShippingCostPayerValues
			? { returnShippingCostPayerValues: rp.returnShippingCostPayerValues.map((v) => v.value) }
			: {}),
		...(rp.categoryTypes?.[0]?.categoryTreeId ? { categoryTreeId: rp.categoryTypes[0].categoryTreeId } : {}),
		...(rp.categoryTypes?.[0]?.categoryId ? { categoryId: rp.categoryTypes[0].categoryId } : {}),
	}));

	const salesTaxJurisdictions: SalesTaxJurisdiction[] = (salesRes?.salesTaxJurisdictions ?? []).map((s) => ({
		jurisdictionId: s.salesTaxJurisdictionId,
		jurisdictionName: s.salesTaxJurisdictionName,
		country: country.toUpperCase(),
	}));

	return {
		marketplaceId: "ebay_us",
		ebayMarketplaceId: ebayMarketplace,
		returnPolicies,
		salesTaxJurisdictions,
	};
}
