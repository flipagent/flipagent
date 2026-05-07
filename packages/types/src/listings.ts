/**
 * `/v1/listings/*` — my for-sale stock. Sell-side write surface.
 *
 * Compresses eBay's three-step Sell Inventory dance
 *   PUT  /sell/inventory/v1/inventory_item/{sku}
 *   POST /sell/inventory/v1/offer
 *   POST /sell/inventory/v1/offer/{offerId}/publish
 * into a single `POST /v1/listings`. Same compression on update / end /
 * relist. The route returns the `Listing` shape that pulls together
 * the inventory-item state, the offer state, and the live listing id.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Marketplace, Money, Page } from "./_common.js";

/**
 * Listing condition. Lower-snake versions of eBay's `condition` enum
 * (`NEW`, `LIKE_NEW`, `USED_GOOD`, …). Kept verbatim because eBay
 * surfaces 15 distinct levels and any "simpler" mapping ("just new /
 * used") loses information graders / refurbishers care about. LLMs
 * pick from this list directly — no translation table.
 */
export const ListingCondition = Type.Union(
	[
		Type.Literal("new"),
		Type.Literal("like_new"),
		Type.Literal("new_other"),
		Type.Literal("new_with_defects"),
		Type.Literal("manufacturer_refurbished"),
		Type.Literal("certified_refurbished"),
		Type.Literal("excellent_refurbished"),
		Type.Literal("very_good_refurbished"),
		Type.Literal("good_refurbished"),
		Type.Literal("seller_refurbished"),
		Type.Literal("used_excellent"),
		Type.Literal("used_very_good"),
		Type.Literal("used_good"),
		Type.Literal("used_acceptable"),
		Type.Literal("for_parts_or_not_working"),
	],
	{ $id: "ListingCondition" },
);
export type ListingCondition = Static<typeof ListingCondition>;

export const ListingFormat = Type.Union([Type.Literal("fixed_price"), Type.Literal("auction")], {
	$id: "ListingFormat",
	default: "fixed_price",
});
export type ListingFormat = Static<typeof ListingFormat>;

export const ListingStatus = Type.Union(
	[
		Type.Literal("draft"),
		Type.Literal("active"),
		Type.Literal("ended"),
		Type.Literal("withdrawn"),
		Type.Literal("out_of_stock"),
	],
	{ $id: "ListingStatus" },
);
export type ListingStatus = Static<typeof ListingStatus>;

/**
 * Listing policies. eBay requires three policy ids on every published
 * offer (return, payment, fulfillment). When omitted on `POST /v1/listings`
 * the orchestrator looks up the seller's most-recent policy of each
 * type via `/sell/account/*_policy`; if none exists it 412s with a
 * pointer to `/v1/policies`.
 */
export const ListingPolicies = Type.Object(
	{
		fulfillmentPolicyId: Type.Optional(Type.String()),
		paymentPolicyId: Type.Optional(Type.String()),
		returnPolicyId: Type.Optional(Type.String()),
	},
	{ $id: "ListingPolicies" },
);
export type ListingPolicies = Static<typeof ListingPolicies>;

export const ListingPackage = Type.Object(
	{
		weight: Type.Optional(
			Type.Object({
				value: Type.Number(),
				unit: Type.Union([
					Type.Literal("pound"),
					Type.Literal("ounce"),
					Type.Literal("kilogram"),
					Type.Literal("gram"),
				]),
			}),
		),
		dimensions: Type.Optional(
			Type.Object({
				length: Type.Number(),
				width: Type.Number(),
				height: Type.Number(),
				unit: Type.Union([
					Type.Literal("inch"),
					Type.Literal("feet"),
					Type.Literal("centimeter"),
					Type.Literal("meter"),
				]),
			}),
		),
		packageType: Type.Optional(Type.String()),
	},
	{ $id: "ListingPackage" },
);
export type ListingPackage = Static<typeof ListingPackage>;

/**
 * Item specifics. eBay accepts multi-valued aspects (`{Color: ["Red",
 * "Black"]}` for a multi-color listing); single-string fields auto-wrap
 * into `[value]` server-side, but exposing the array form keeps power
 * users honest.
 */
export const ListingAspects = Type.Record(Type.String(), Type.Array(Type.String()), {
	$id: "ListingAspects",
	description: "Item specifics — Brand/Model/Size/etc. Multi-valued.",
});
export type ListingAspects = Static<typeof ListingAspects>;

export const Listing = Type.Object(
	{
		/** eBay listing id (numeric, `ebay.com/itm/{id}`). Empty string while status='draft'. */
		id: Type.String(),
		/** Caller-supplied or flipagent-generated SKU. Stable across update/relist. */
		sku: Type.String(),
		/** eBay offer id — kept so update / end / relist can re-target without a lookup. */
		offerId: Type.Optional(Type.String()),
		marketplace: Marketplace,
		status: ListingStatus,

		title: Type.String(),
		description: Type.Optional(Type.String()),
		price: Money,
		quantity: Type.Integer({ minimum: 0 }),
		condition: ListingCondition,
		conditionDescription: Type.Optional(Type.String()),

		categoryId: Type.String(),
		aspects: Type.Optional(ListingAspects),
		images: Type.Array(Type.String()),

		format: ListingFormat,
		policies: Type.Optional(ListingPolicies),
		merchantLocationKey: Type.Optional(Type.String()),
		package: Type.Optional(ListingPackage),

		// Catalog identifiers (echoed back from inventory_item.product)
		gtin: Type.Optional(Type.String()),
		upc: Type.Optional(Type.Array(Type.String())),
		ean: Type.Optional(Type.Array(Type.String())),
		isbn: Type.Optional(Type.Array(Type.String())),
		mpn: Type.Optional(Type.String()),
		brand: Type.Optional(Type.String()),
		epid: Type.Optional(Type.String()),

		lotSize: Type.Optional(Type.Integer({ minimum: 1 })),
		quantityLimitPerBuyer: Type.Optional(Type.Integer({ minimum: 1 })),

		/** `https://www.ebay.com/itm/{id}` — populated when status='active'. */
		url: Type.Optional(Type.String()),

		createdAt: Type.String({ description: "ISO 8601 — first time the listing entered our system." }),
		updatedAt: Type.Optional(Type.String()),
	},
	{ $id: "Listing" },
);
export type Listing = Static<typeof Listing>;

/**
 * `POST /v1/listings` body. Required fields are the bare minimum to
 * reach `status='active'`; everything else is auto-resolved or carries
 * a sensible default. Cents-int prices throughout — eBay's dollar
 * strings happen at the service boundary.
 */
export const ListingCreate = Type.Object(
	{
		title: Type.String({ maxLength: 80 }),
		description: Type.Optional(Type.String()),
		price: Money,
		quantity: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
		condition: ListingCondition,
		conditionDescription: Type.Optional(Type.String()),
		categoryId: Type.String(),
		aspects: Type.Optional(ListingAspects),
		images: Type.Array(Type.String(), { minItems: 1, maxItems: 24 }),
		format: Type.Optional(ListingFormat),
		marketplace: Type.Optional(Marketplace),

		/** Auto-generated when omitted (`flipagent-{nanoid}`). */
		sku: Type.Optional(Type.String()),

		/** Auto-discovered from /sell/account/*_policy when omitted (24h cache). */
		policies: Type.Optional(ListingPolicies),
		/** Auto-discovered from /sell/inventory/v1/location when omitted. */
		merchantLocationKey: Type.Optional(Type.String()),

		package: Type.Optional(ListingPackage),

		// Catalog identifiers — eBay InventoryProduct accepts each.
		gtin: Type.Optional(Type.String({ description: "Global trade id; eBay routes to upc/ean/isbn by length." })),
		upc: Type.Optional(Type.Array(Type.String())),
		ean: Type.Optional(Type.Array(Type.String())),
		isbn: Type.Optional(Type.Array(Type.String())),
		mpn: Type.Optional(Type.String({ description: "Manufacturer part number." })),
		brand: Type.Optional(Type.String()),
		epid: Type.Optional(
			Type.String({ description: "eBay catalog product id (links listing to canonical product)." }),
		),

		// Listing-side limits & lots
		lotSize: Type.Optional(Type.Integer({ minimum: 1, description: "Number of units in a lot listing." })),
		quantityLimitPerBuyer: Type.Optional(Type.Integer({ minimum: 1 })),

		// Motors / parts compatibility — eBay's `compatibility` block on inventory_item
		compatibility: Type.Optional(
			Type.Object({
				compatibleProducts: Type.Array(
					Type.Object({
						productFamilyProperties: Type.Optional(
							Type.Object({
								make: Type.Optional(Type.String()),
								model: Type.Optional(Type.String()),
								year: Type.Optional(Type.String()),
								trim: Type.Optional(Type.String()),
								engine: Type.Optional(Type.String()),
							}),
						),
						productIdentifier: Type.Optional(
							Type.Object({ ePID: Type.Optional(Type.String()), gtin: Type.Optional(Type.String()) }),
						),
						notes: Type.Optional(Type.String()),
					}),
				),
			}),
		),

		// Pickup / in-store availability (eBay In-Store Pickup)
		pickupAtLocation: Type.Optional(
			Type.Array(
				Type.Object({
					merchantLocationKey: Type.String(),
					quantity: Type.Integer({ minimum: 0 }),
					availabilityType: Type.Optional(
						Type.Union([Type.Literal("IN_STOCK"), Type.Literal("OUT_OF_STOCK"), Type.Literal("SHIP_TO_STORE")]),
					),
				}),
			),
		),
	},
	{ $id: "ListingCreate" },
);
export type ListingCreate = Static<typeof ListingCreate>;

export const ListingUpdate = Type.Object(
	{
		title: Type.Optional(Type.String({ maxLength: 80 })),
		description: Type.Optional(Type.String()),
		price: Type.Optional(Money),
		quantity: Type.Optional(Type.Integer({ minimum: 0 })),
		conditionDescription: Type.Optional(Type.String()),
		aspects: Type.Optional(ListingAspects),
		images: Type.Optional(Type.Array(Type.String(), { minItems: 1, maxItems: 24 })),
		policies: Type.Optional(ListingPolicies),
		package: Type.Optional(ListingPackage),
	},
	{ $id: "ListingUpdate" },
);
export type ListingUpdate = Static<typeof ListingUpdate>;

export const ListingsListQuery = Type.Object(
	{
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
		offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
		status: Type.Optional(ListingStatus),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "ListingsListQuery" },
);
export type ListingsListQuery = Static<typeof ListingsListQuery>;

export const ListingsListResponse = Type.Composite(
	[
		Page,
		Type.Object({
			listings: Type.Array(Listing),
		}),
	],
	{ $id: "ListingsListResponse" },
);
export type ListingsListResponse = Static<typeof ListingsListResponse>;

export const ListingResponse = Type.Composite([Listing], {
	$id: "ListingResponse",
});
export type ListingResponse = Static<typeof ListingResponse>;

/**
 * Pre-publish fee preview — wraps eBay Sell Inventory
 * `POST /offer/get_listing_fees`. Takes a list of UNPUBLISHED offer
 * ids (caller must have already created the drafts via POST /v1/listings
 * or the inventory APIs) and returns the fees eBay will charge per
 * marketplace if those offers were published. For "estimate fees on a
 * hypothetical listing I haven't drafted yet", use POST /v1/listings/verify
 * (Trading VerifyAddItem) instead — it doesn't require a draft.
 */
export const ListingPreviewFeesRequest = Type.Object(
	{
		offerIds: Type.Array(Type.String(), { minItems: 1, maxItems: 250 }),
	},
	{ $id: "ListingPreviewFeesRequest" },
);
export type ListingPreviewFeesRequest = Static<typeof ListingPreviewFeesRequest>;

export const ListingFeeLine = Type.Object(
	{
		feeType: Type.String({ description: "eBay fee category — InsertionFee, FinalValueFee, etc." }),
		amount: Money,
		promotionalDiscount: Type.Optional(Money),
	},
	{ $id: "ListingFeeLine" },
);
export type ListingFeeLine = Static<typeof ListingFeeLine>;

export const ItemGroupActionRequest = Type.Object(
	{
		inventoryItemGroupKey: Type.String(),
		marketplaceId: Type.String({ description: "EBAY_US, EBAY_DE, etc." }),
	},
	{ $id: "ItemGroupActionRequest" },
);
export type ItemGroupActionRequest = Static<typeof ItemGroupActionRequest>;

export const ItemGroupPublishResponse = Type.Object(
	{
		listingId: Type.Union([Type.String(), Type.Null()]),
		warnings: Type.Array(Type.Object({ message: Type.String(), errorId: Type.Optional(Type.Integer()) })),
	},
	{ $id: "ItemGroupPublishResponse" },
);
export type ItemGroupPublishResponse = Static<typeof ItemGroupPublishResponse>;

// Internal — NOT `CompatibilityProperty` (that name is owned by
// `compatibility.ts` for the Taxonomy/Compatibility-API shape with
// `name` + `localizedName`). Inventory product_compatibility uses
// just name/value pairs, hence the different shape + name.
const CompatibilityRowProperty = Type.Object(
	{ name: Type.String(), value: Type.String() },
	{ $id: "CompatibilityRowProperty" },
);

export const CompatibilityRow = Type.Object(
	{
		productFamilyProperties: Type.Optional(Type.Record(Type.String(), Type.String())),
		properties: Type.Array(CompatibilityRowProperty),
		notes: Type.Optional(Type.String()),
	},
	{ $id: "CompatibilityRow" },
);
export type CompatibilityRow = Static<typeof CompatibilityRow>;

export const ProductCompatibilityResponse = Type.Object(
	{
		compatibleProducts: Type.Array(CompatibilityRow),
	},
	{ $id: "ProductCompatibilityResponse" },
);
export type ProductCompatibilityResponse = Static<typeof ProductCompatibilityResponse>;

export const ProductCompatibilityRequest = Type.Object(
	{ compatibleProducts: Type.Array(CompatibilityRow) },
	{ $id: "ProductCompatibilityRequest" },
);
export type ProductCompatibilityRequest = Static<typeof ProductCompatibilityRequest>;

const SkuLocationAvailability = Type.Object(
	{
		merchantLocationKey: Type.String(),
		availability: Type.Optional(
			Type.Object({
				quantity: Type.Integer({ minimum: 0 }),
				allocationByFormat: Type.Optional(
					Type.Object({
						auction: Type.Optional(Type.Integer({ minimum: 0 })),
						fixedPrice: Type.Optional(Type.Integer({ minimum: 0 })),
					}),
				),
			}),
		),
	},
	{ $id: "SkuLocationAvailability" },
);

export const SkuLocationsRequest = Type.Object(
	{ locations: Type.Array(SkuLocationAvailability, { minItems: 1, maxItems: 50 }) },
	{ $id: "SkuLocationsRequest" },
);
export type SkuLocationsRequest = Static<typeof SkuLocationsRequest>;

export const SkuLocationsResponse = Type.Object(
	{ locations: Type.Array(SkuLocationAvailability) },
	{ $id: "SkuLocationsResponse" },
);
export type SkuLocationsResponse = Static<typeof SkuLocationsResponse>;

export const ListingPreviewFeesResponse = Type.Object(
	{
		summaries: Type.Array(
			Type.Object({
				marketplaceId: Type.String(),
				fees: Type.Array(ListingFeeLine),
				totalCents: Type.Integer({ minimum: 0, description: "Sum of fee amounts (after promotional discounts)." }),
				warnings: Type.Optional(
					Type.Array(Type.Object({ message: Type.String(), errorId: Type.Optional(Type.Integer()) })),
				),
			}),
		),
	},
	{ $id: "ListingPreviewFeesResponse" },
);
export type ListingPreviewFeesResponse = Static<typeof ListingPreviewFeesResponse>;

/**
 * `POST /v1/listings/draft` — create an eBay listing draft from a URL,
 * EPID, or raw aspects payload. Wraps `/sell/listing/v1_beta/item_draft`.
 * The seller finishes the draft on ebay.com (we return the redirect
 * URL); useful for "give me a one-click pre-filled listing" agent flows.
 */
export const ListingDraftRequest = Type.Object(
	{
		raw: Type.Unknown({
			description: "Pass-through to eBay's ItemDraft body shape. See sell/listing OAS for fields.",
		}),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "ListingDraftRequest" },
);
export type ListingDraftRequest = Static<typeof ListingDraftRequest>;

export const ListingDraftResponse = Type.Object(
	{
		itemDraftId: Type.String(),
		listingRedirectUrl: Type.Optional(Type.String()),
	},
	{ $id: "ListingDraftResponse" },
);
export type ListingDraftResponse = Static<typeof ListingDraftResponse>;
