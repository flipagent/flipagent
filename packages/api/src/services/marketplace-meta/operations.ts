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
		marketplaceId: "ebay",
		ebayMarketplaceId: ebayMarketplace,
		returnPolicies,
		salesTaxJurisdictions,
	};
}
