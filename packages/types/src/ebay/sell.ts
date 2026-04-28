/**
 * TypeBox schemas mirroring eBay Sell-side request bodies that flipagent's
 * MCP tools and api routes accept. Field names + nesting match eBay's REST
 * API verbatim — passed through to api.ebay.com unmodified.
 *
 * Schemas are intentionally permissive: only the fields needed for the
 * minimum viable list/ship/payout flow are required. Optional fields exist
 * but eBay's full surface (compatibility, lots of policy knobs, etc.) is
 * not enumerated — passthrough still accepts them when present.
 *
 * @see https://developer.ebay.com/api-docs/sell/inventory/resources/inventory_item/methods/createOrReplaceInventoryItem
 * @see https://developer.ebay.com/api-docs/sell/inventory/resources/offer/methods/createOffer
 * @see https://developer.ebay.com/api-docs/sell/fulfillment/resources/order/shipping_fulfillment/methods/createShippingFulfillment
 */

import { type Static, Type } from "@sinclair/typebox";
import { Money } from "./buy.js";

// ─── Inventory Item ───────────────────────────────────────────────────────

export const InventoryConditionEnum = Type.Union(
	[
		Type.Literal("NEW"),
		Type.Literal("LIKE_NEW"),
		Type.Literal("NEW_OTHER"),
		Type.Literal("NEW_WITH_DEFECTS"),
		Type.Literal("MANUFACTURER_REFURBISHED"),
		Type.Literal("CERTIFIED_REFURBISHED"),
		Type.Literal("EXCELLENT_REFURBISHED"),
		Type.Literal("VERY_GOOD_REFURBISHED"),
		Type.Literal("GOOD_REFURBISHED"),
		Type.Literal("SELLER_REFURBISHED"),
		Type.Literal("USED_EXCELLENT"),
		Type.Literal("USED_VERY_GOOD"),
		Type.Literal("USED_GOOD"),
		Type.Literal("USED_ACCEPTABLE"),
		Type.Literal("FOR_PARTS_OR_NOT_WORKING"),
	],
	{ $id: "InventoryConditionEnum" },
);
export type InventoryConditionEnum = Static<typeof InventoryConditionEnum>;

export const PackageDimensions = Type.Object(
	{
		length: Type.Number(),
		width: Type.Number(),
		height: Type.Number(),
		unit: Type.Union([Type.Literal("INCH"), Type.Literal("FEET"), Type.Literal("CENTIMETER"), Type.Literal("METER")]),
	},
	{ $id: "PackageDimensions" },
);
export type PackageDimensions = Static<typeof PackageDimensions>;

export const PackageWeight = Type.Object(
	{
		value: Type.Number(),
		unit: Type.Union([Type.Literal("POUND"), Type.Literal("OUNCE"), Type.Literal("KILOGRAM"), Type.Literal("GRAM")]),
	},
	{ $id: "PackageWeight" },
);
export type PackageWeight = Static<typeof PackageWeight>;

export const PackageWeightAndSize = Type.Object(
	{
		dimensions: Type.Optional(PackageDimensions),
		weight: Type.Optional(PackageWeight),
		packageType: Type.Optional(Type.String()),
	},
	{ $id: "PackageWeightAndSize" },
);
export type PackageWeightAndSize = Static<typeof PackageWeightAndSize>;

export const InventoryProduct = Type.Object(
	{
		title: Type.String({ description: "Listing title; eBay limits to 80 chars on most marketplaces." }),
		description: Type.Optional(Type.String()),
		aspects: Type.Optional(Type.Record(Type.String(), Type.Array(Type.String()))),
		imageUrls: Type.Optional(Type.Array(Type.String())),
		brand: Type.Optional(Type.String()),
		mpn: Type.Optional(Type.String()),
		upc: Type.Optional(Type.Array(Type.String())),
		ean: Type.Optional(Type.Array(Type.String())),
		isbn: Type.Optional(Type.Array(Type.String())),
		epid: Type.Optional(Type.String()),
	},
	{ $id: "InventoryProduct" },
);
export type InventoryProduct = Static<typeof InventoryProduct>;

export const ShipToLocationAvailability = Type.Object(
	{
		quantity: Type.Integer({ minimum: 0 }),
	},
	{ $id: "ShipToLocationAvailability" },
);

export const InventoryAvailability = Type.Object(
	{
		shipToLocationAvailability: Type.Optional(ShipToLocationAvailability),
	},
	{ $id: "InventoryAvailability" },
);
export type InventoryAvailability = Static<typeof InventoryAvailability>;

export const InventoryItem = Type.Object(
	{
		product: Type.Optional(InventoryProduct),
		condition: Type.Optional(InventoryConditionEnum),
		conditionDescription: Type.Optional(Type.String()),
		availability: Type.Optional(InventoryAvailability),
		packageWeightAndSize: Type.Optional(PackageWeightAndSize),
		locale: Type.Optional(Type.String({ description: "BCP-47, e.g. en_US." })),
	},
	{ $id: "InventoryItem" },
);
export type InventoryItem = Static<typeof InventoryItem>;

// ─── Offer ────────────────────────────────────────────────────────────────

export const OfferPricingSummary = Type.Object(
	{
		price: Money,
	},
	{ $id: "OfferPricingSummary" },
);
export type OfferPricingSummary = Static<typeof OfferPricingSummary>;

export const OfferListingPolicies = Type.Object(
	{
		fulfillmentPolicyId: Type.Optional(Type.String()),
		paymentPolicyId: Type.Optional(Type.String()),
		returnPolicyId: Type.Optional(Type.String()),
	},
	{ $id: "OfferListingPolicies" },
);
export type OfferListingPolicies = Static<typeof OfferListingPolicies>;

export const OfferDetails = Type.Object(
	{
		sku: Type.String(),
		marketplaceId: Type.String({ default: "EBAY_US" }),
		format: Type.Union([Type.Literal("FIXED_PRICE"), Type.Literal("AUCTION")], { default: "FIXED_PRICE" }),
		pricingSummary: OfferPricingSummary,
		listingDescription: Type.Optional(Type.String()),
		categoryId: Type.String(),
		listingPolicies: Type.Optional(OfferListingPolicies),
		merchantLocationKey: Type.String({
			description: "Reference to a previously-created `/sell/inventory/v1/location/{key}`.",
		}),
		quantityLimitPerBuyer: Type.Optional(Type.Integer({ minimum: 1 })),
		includeCatalogProductDetails: Type.Optional(Type.Boolean()),
	},
	{ $id: "OfferDetails" },
);
export type OfferDetails = Static<typeof OfferDetails>;

// ─── Shipping Fulfillment ─────────────────────────────────────────────────

export const ShippingLineItem = Type.Object(
	{
		lineItemId: Type.String(),
		quantity: Type.Integer({ minimum: 1 }),
	},
	{ $id: "ShippingLineItem" },
);
export type ShippingLineItem = Static<typeof ShippingLineItem>;

export const ShippingFulfillmentDetails = Type.Object(
	{
		lineItems: Type.Array(ShippingLineItem),
		shippedDate: Type.Optional(Type.String({ description: "ISO 8601 timestamp." })),
		shippingCarrierCode: Type.String({
			description: "eBay carrier code, e.g. USPS, UPS, FEDEX, DHL.",
		}),
		trackingNumber: Type.String(),
	},
	{ $id: "ShippingFulfillmentDetails" },
);
export type ShippingFulfillmentDetails = Static<typeof ShippingFulfillmentDetails>;
