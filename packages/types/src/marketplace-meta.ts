/**
 * `/v1/marketplaces/{id}` — per-marketplace metadata (return-window
 * options, sales-tax jurisdictions, listing structure policies).
 * Wraps eBay sell/metadata.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Marketplace, Money, ResponseSource } from "./_common.js";

export const ReturnPolicyOption = Type.Object(
	{
		returnsAcceptedValues: Type.Array(Type.Boolean()),
		returnPeriodValues: Type.Array(Type.Object({ value: Type.Integer(), unit: Type.String() })),
		returnMethodValues: Type.Optional(Type.Array(Type.String())),
		refundMethodValues: Type.Optional(Type.Array(Type.String())),
		returnShippingCostPayerValues: Type.Optional(Type.Array(Type.String())),
		categoryTreeId: Type.Optional(Type.String()),
		categoryId: Type.Optional(Type.String()),
	},
	{ $id: "ReturnPolicyOption" },
);
export type ReturnPolicyOption = Static<typeof ReturnPolicyOption>;

export const SalesTaxJurisdiction = Type.Object(
	{
		jurisdictionId: Type.String(),
		jurisdictionName: Type.String(),
		country: Type.String(),
	},
	{ $id: "SalesTaxJurisdiction" },
);
export type SalesTaxJurisdiction = Static<typeof SalesTaxJurisdiction>;

export const MarketplaceMetadata = Type.Object(
	{
		marketplaceId: Marketplace,
		ebayMarketplaceId: Type.String({ description: "Underlying eBay marketplace code, e.g. EBAY_US." }),
		returnPolicies: Type.Optional(Type.Array(ReturnPolicyOption)),
		salesTaxJurisdictions: Type.Optional(Type.Array(SalesTaxJurisdiction)),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "MarketplaceMetadata" },
);
export type MarketplaceMetadata = Static<typeof MarketplaceMetadata>;

export const MarketplaceMetadataQuery = Type.Object(
	{
		marketplace: Type.Optional(Marketplace),
		country: Type.Optional(Type.String({ minLength: 2, maxLength: 2 })),
	},
	{ $id: "MarketplaceMetadataQuery" },
);
export type MarketplaceMetadataQuery = Static<typeof MarketplaceMetadataQuery>;

/* ----- digital_signature_routes (sell/metadata) ---------------------- */

export const DigitalSignatureRoute = Type.Object(
	{
		fromCountry: Type.String(),
		toCountry: Type.String(),
		signatureRequired: Type.Boolean(),
		thresholdAmount: Type.Optional(Money),
	},
	{ $id: "DigitalSignatureRoute" },
);
export type DigitalSignatureRoute = Static<typeof DigitalSignatureRoute>;

export const DigitalSignatureRoutesResponse = Type.Object(
	{ routes: Type.Array(DigitalSignatureRoute), source: Type.Optional(ResponseSource) },
	{ $id: "DigitalSignatureRoutesResponse" },
);
export type DigitalSignatureRoutesResponse = Static<typeof DigitalSignatureRoutesResponse>;
