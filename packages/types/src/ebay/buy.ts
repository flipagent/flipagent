/**
 * TypeBox schemas mirroring eBay's Browse + Marketplace Insights response
 * shapes. We don't ship a full eBay OpenAPI port — only the fields used by
 * mcp tools and api routes. Field names + nesting match eBay verbatim
 * so callers using the official eBay SDK at api.ebay.com see the same shape
 * when pointed at api.flipagent.dev.
 *
 * @see https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search
 */

import { type Static, Type } from "@sinclair/typebox";

export const Money = Type.Object(
	{
		value: Type.String(),
		currency: Type.String(),
	},
	{ $id: "Money" },
);
export type Money = Static<typeof Money>;

export const Image = Type.Object(
	{
		imageUrl: Type.String(),
	},
	{ $id: "Image" },
);

export const ShippingOption = Type.Object(
	{
		shippingCost: Type.Optional(Money),
		shippingCostType: Type.Optional(Type.String()),
	},
	{ $id: "ShippingOption" },
);

export const Seller = Type.Object(
	{
		username: Type.Optional(Type.String()),
		feedbackScore: Type.Optional(Type.Integer()),
		feedbackPercentage: Type.Optional(Type.String()),
	},
	{ $id: "Seller" },
);

const BuyingOptions = Type.Array(
	Type.Union([Type.Literal("AUCTION"), Type.Literal("FIXED_PRICE"), Type.Literal("BEST_OFFER")]),
);

export const ItemLocation = Type.Object(
	{
		city: Type.Optional(Type.String()),
		stateOrProvince: Type.Optional(Type.String()),
		postalCode: Type.Optional(Type.String()),
		country: Type.Optional(Type.String()),
	},
	{ $id: "ItemLocation" },
);
export type ItemLocation = Static<typeof ItemLocation>;

/**
 * `ItemSummary` — element of search results. Mirror of eBay Browse
 * `ItemSummary`, augmented with the sold-only fields from
 * Marketplace Insights `getItemSales` (`lastSoldDate`, `lastSoldPrice`,
 * `totalSoldQuantity`) so the same shape carries both `itemSummaries[]`
 * (active) and `itemSales[]` (sold).
 *
 * Strict eBay-shape parity — every field below appears in either Browse
 * `ItemSummary` or Marketplace Insights `getItemSales`. We do not add
 * flipagent-specific fields here; structured sub-SKU descriptors live
 * on `ItemDetail.localizedAspects` (Browse `getItem` spec).
 */
export const ItemSummary = Type.Object(
	{
		itemId: Type.String(),
		legacyItemId: Type.Optional(Type.String()),
		title: Type.String(),
		itemWebUrl: Type.String(),
		/** Affiliate-tracking variant of `itemWebUrl` when the request used the affiliate header. */
		itemAffiliateWebUrl: Type.Optional(Type.String()),
		/** Browse REST resource href for the item — `getItem` URL. */
		itemHref: Type.Optional(Type.String()),
		condition: Type.Optional(Type.String()),
		conditionId: Type.Optional(Type.String()),
		price: Type.Optional(Money),
		lastSoldPrice: Type.Optional(Money),
		shippingOptions: Type.Optional(Type.Array(ShippingOption)),
		buyingOptions: Type.Optional(BuyingOptions),
		bidCount: Type.Optional(Type.Integer()),
		currentBidPrice: Type.Optional(Money),
		watchCount: Type.Optional(Type.Integer()),
		itemEndDate: Type.Optional(Type.String()),
		/**
		 * ISO 8601 listing creation timestamp. Paired with `itemEndDate` or
		 * `lastSoldDate`, this gives the list-to-sell duration that the
		 * hazard model reads directly from summaries — no per-listing detail
		 * fetch required.
		 */
		itemCreationDate: Type.Optional(Type.String()),
		lastSoldDate: Type.Optional(Type.String()),
		totalSoldQuantity: Type.Optional(Type.Integer()),
		seller: Type.Optional(Seller),
		image: Type.Optional(Image),
		thumbnailImages: Type.Optional(Type.Array(Image)),
		additionalImages: Type.Optional(Type.Array(Image)),
		topRatedBuyingExperience: Type.Optional(Type.Boolean()),
		/**
		 * eBay product identifier — present when the listing is linked to a
		 * catalog product. Same `epid` across every listing of the same SKU,
		 * so a single search response can be deterministically grouped by
		 * product without any per-item detail fetch.
		 */
		epid: Type.Optional(Type.String()),
		/** Global Trade Item Number — UPC / EAN / ISBN. Fallback grouping key when `epid` isn't catalog-linked. */
		gtin: Type.Optional(Type.String()),
		/** Top-level eBay category id for the listing. */
		categoryId: Type.Optional(Type.String()),
		/** Leaf category ids — Browse search returns these on items in catalog-linked or specific-category results. */
		leafCategoryIds: Type.Optional(Type.Array(Type.String())),
		/** Item-group container ref when the listing is part of a multi-variation group. */
		itemGroupHref: Type.Optional(Type.String()),
		/** Multi-variation group type tag (e.g. "SELLER_DEFINED_VARIATIONS"). */
		itemGroupType: Type.Optional(Type.String()),
		itemLocation: Type.Optional(ItemLocation),
		/** Marketplace the listing is on — `EBAY_US`, `EBAY_GB`, … */
		listingMarketplaceId: Type.Optional(Type.String()),
		/** True when the item is restricted to adult buyers. */
		adultOnly: Type.Optional(Type.Boolean()),
		/** True when at least one coupon is available against the item. */
		availableCoupons: Type.Optional(Type.Boolean()),
	},
	{ $id: "ItemSummary" },
);
export type ItemSummary = Static<typeof ItemSummary>;

/**
 * `SearchPagedCollection` envelope. Active searches populate `itemSummaries`;
 * sold (Marketplace Insights) populate `itemSales`. Same shape, different field.
 *
 * `source` mirrors the `X-Flipagent-Source` header so consumers reading the
 * JSON body don't have to inspect headers. `"scrape"` = HTML parser path,
 * `"rest"` = eBay REST passthrough (Insights-approved tenants), `"cache:*"`
 * = served from the response cache. Optional for forward compatibility with
 * pre-source-field clients; fresh responses always set it.
 */
export const BrowseSearchSource = Type.Union(
	[
		Type.Literal("rest"),
		Type.Literal("scrape"),
		Type.Literal("bridge"),
		Type.Literal("cache:rest"),
		Type.Literal("cache:scrape"),
		Type.Literal("cache:bridge"),
	],
	{ $id: "BrowseSearchSource" },
);
export type BrowseSearchSource = Static<typeof BrowseSearchSource>;

export const BrowseSearchResponse = Type.Object(
	{
		href: Type.Optional(Type.String()),
		total: Type.Optional(Type.Integer()),
		limit: Type.Optional(Type.Integer()),
		offset: Type.Optional(Type.Integer()),
		itemSummaries: Type.Optional(Type.Array(ItemSummary)),
		itemSales: Type.Optional(Type.Array(ItemSummary)),
		source: Type.Optional(BrowseSearchSource),
	},
	{ $id: "BrowseSearchResponse" },
);
export type BrowseSearchResponse = Static<typeof BrowseSearchResponse>;

export const EstimatedAvailability = Type.Object(
	{
		estimatedAvailabilityStatus: Type.Optional(Type.String()),
		estimatedAvailableQuantity: Type.Optional(Type.Integer()),
		estimatedSoldQuantity: Type.Optional(Type.Integer()),
		estimatedRemainingQuantity: Type.Optional(Type.Integer()),
	},
	{ $id: "EstimatedAvailability" },
);

/**
 * One row of the Item Specifics table on a listing's detail page.
 * Mirror of Browse REST `getItem.localizedAspects[]`. `type` is a
 * pass-through label ("STRING", "MEASUREMENT", "DATE") eBay attaches
 * for display formatting; we only emit `STRING` since the search-page
 * scraper has no other signal.
 */
export const LocalizedAspect = Type.Object(
	{
		name: Type.String(),
		value: Type.String(),
		type: Type.Optional(Type.String()),
	},
	{ $id: "LocalizedAspect" },
);
export type LocalizedAspect = Static<typeof LocalizedAspect>;

export const ItemDetail = Type.Object(
	{
		itemId: Type.String(),
		legacyItemId: Type.Optional(Type.String()),
		title: Type.String(),
		itemWebUrl: Type.String(),
		condition: Type.Optional(Type.String()),
		conditionId: Type.Optional(Type.String()),
		price: Type.Optional(Money),
		shippingOptions: Type.Optional(Type.Array(ShippingOption)),
		buyingOptions: Type.Optional(BuyingOptions),
		bidCount: Type.Optional(Type.Integer()),
		currentBidPrice: Type.Optional(Money),
		watchCount: Type.Optional(Type.Integer()),
		/** ISO 8601 listing end timestamp (sold/ended date for completed items). */
		itemEndDate: Type.Optional(Type.String()),
		/** ISO 8601 listing creation timestamp. Together with itemEndDate, gives time-to-sell. */
		itemCreationDate: Type.Optional(Type.String()),
		/** "EBAY_US", "EBAY_DE", … — listing's home marketplace. */
		listingMarketplaceId: Type.Optional(Type.String()),
		/** Number of times the seller has revised the listing. */
		sellerItemRevision: Type.Optional(Type.String()),
		seller: Type.Optional(Seller),
		itemLocation: Type.Optional(ItemLocation),
		description: Type.Optional(Type.String()),
		shortDescription: Type.Optional(Type.String()),
		categoryPath: Type.Optional(Type.String()),
		categoryId: Type.Optional(Type.String()),
		categoryIdPath: Type.Optional(Type.String()),
		/**
		 * Item Specifics — Browse REST `localizedAspects`. Structured
		 * key/value pairs (Brand, Model, Movement, Case Material, …).
		 * Replaces the older flat `brand` / `color` / `material` fields:
		 * those covered three aspects in a category (watches, fashion);
		 * `localizedAspects` carries every aspect the listing has for
		 * any category, matching what eBay actually returns.
		 */
		localizedAspects: Type.Optional(Type.Array(LocalizedAspect)),
		/** Top-level promotion of `localizedAspects` "Brand". Browse REST exposes both. */
		brand: Type.Optional(Type.String()),
		/** Top-level promotion of `localizedAspects` "UPC" / "EAN" / "ISBN". */
		gtin: Type.Optional(Type.String()),
		topRatedBuyingExperience: Type.Optional(Type.Boolean()),
		image: Type.Optional(Image),
		additionalImages: Type.Optional(Type.Array(Image)),
		estimatedAvailabilities: Type.Optional(Type.Array(EstimatedAvailability)),
	},
	{ $id: "ItemDetail" },
);
export type ItemDetail = Static<typeof ItemDetail>;

/* -------------------------- request param schemas -------------------------- */

/**
 * Query parameters for /buy/browse/v1/item_summary/search.
 *
 * `category_ids` is exposed to honour the same shape eBay Browse REST
 * accepts (pipe-joined Browse category id list, e.g. `15709|175672`).
 * The REST source forwards it directly; the bridge source forwards it
 * to the extension. The scrape source today **does not** honour it —
 * eBay is migrating category SRP from the `s-item__*` layout (which our
 * parser targets) to a JS-driven `brwrvr__item-card-*` browse layout
 * served at `/b/<slug>/<id>/...`, and empty-keyword + `_sacat=<id>`
 * triggers a 301 to that lazy-loaded layout. `q` therefore stays
 * required so the keyword SRP path always works. `category_ids` is
 * still recorded on the anonymized query pulse regardless of source so
 * `/v1/trends/categories` can rank demand by category once enough data
 * accrues.
 */
export const BrowseSearchQuery = Type.Object(
	{
		q: Type.String({ description: "Search keywords. Required across all sources today." }),
		category_ids: Type.Optional(
			Type.String({
				description:
					"Pipe-joined Browse category ids, e.g. '15709|175672'. Forwarded verbatim by the REST source; ignored by the scrape source (keyword SRP only); fed into the demand-pulse archive in all cases.",
			}),
		),
		filter: Type.Optional(
			Type.String({
				description:
					'eBay filter expression, e.g. "buyingOptions:{FIXED_PRICE}" or "conditionIds:{3000}". See eBay docs.',
			}),
		),
		sort: Type.Optional(
			Type.String({
				description: 'Sort key. Common values: "newlyListed", "endingSoonest", "pricePlusShippingLowest".',
			}),
		),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 25 })),
		offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
		/**
		 * eBay aspect-based refinement, format
		 * `categoryId:<id>,Aspect1:{Value1|Value2},Aspect2:{Value}`. The
		 * categoryId prefix is required by eBay. Most useful for SKU-tier
		 * narrowing (Color/Size/Brand) — pairs with the per-variation
		 * aspects we surface on item detail.
		 */
		aspect_filter: Type.Optional(Type.String()),
		/**
		 * UPC / EAN / ISBN. Searches by the listing's GTIN aspect — useful
		 * for catalog-driven flows where you already have the product's
		 * universal identifier.
		 */
		gtin: Type.Optional(Type.String()),
		/**
		 * eBay catalog product id (ePID). Returns every listing tied to that
		 * catalog entry — the cleanest way to gather "all listings of this
		 * exact product" for cross-seller comparison.
		 */
		epid: Type.Optional(Type.String()),
		/**
		 * Comma-joined response field-group selector. eBay supports
		 * `MATCHING_ITEMS` (default), `EXTENDED`, `ASPECT_REFINEMENTS`,
		 * `BUYING_OPTIONS_REFINEMENTS`, `CATEGORY_REFINEMENTS`,
		 * `CONDITION_REFINEMENTS`, `LISTING_TYPE_REFINEMENTS`, `FULL`.
		 * Lets callers fetch the refinement aggregations alongside results.
		 */
		fieldgroups: Type.Optional(Type.String()),
		/**
		 * Toggle eBay's keyword autocorrect. Single legal value: `KEYWORD`.
		 */
		auto_correct: Type.Optional(Type.String()),
		/**
		 * Auto-parts vehicle compatibility filter, format
		 * `name1:value1;name2:value2` (e.g. `Year:2010;Make:Honda;Model:Civic`).
		 * REST-only; ignored by scrape/bridge.
		 */
		compatibility_filter: Type.Optional(Type.String()),
		/**
		 * Pipe-joined eBay charity ids — restricts results to charity
		 * listings registered to those organizations.
		 */
		charity_ids: Type.Optional(Type.String()),
	},
	{ $id: "BrowseSearchQuery" },
);
export type BrowseSearchQuery = Static<typeof BrowseSearchQuery>;

/**
 * Query parameters for /buy/marketplace_insights/v1_beta/item_sales/search.
 * Marketplace Insights mirrors most Browse search params but does NOT
 * support `sort`, `auto_correct`, `compatibility_filter`, or `charity_ids`
 * (eBay's spec). aspect_filter / gtin / epid / fieldgroups all apply.
 */
export const SoldSearchQuery = Type.Object(
	{
		q: Type.String({ description: "Keyword for sold listings." }),
		category_ids: Type.Optional(
			Type.String({
				description: "Pipe-joined Browse category ids. Same semantics as BrowseSearchQuery.category_ids.",
			}),
		),
		filter: Type.Optional(Type.String()),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
		offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
		/** Same `categoryId:<id>,Axis:{Value}` shape as BrowseSearchQuery.aspect_filter. */
		aspect_filter: Type.Optional(Type.String()),
		/** Restrict sold lookups to a UPC / EAN / ISBN. */
		gtin: Type.Optional(Type.String()),
		/** Restrict sold lookups to one eBay catalog product id (ePID). */
		epid: Type.Optional(Type.String()),
		/** Comma-joined response field-group selector. Same enum as Browse. */
		fieldgroups: Type.Optional(Type.String()),
	},
	{ $id: "SoldSearchQuery" },
);
export type SoldSearchQuery = Static<typeof SoldSearchQuery>;

/** Path parameter for /buy/browse/v1/item/{itemId}. */
export const ItemDetailParams = Type.Object(
	{
		itemId: Type.String({
			description: "eBay item id, e.g. 'v1|123456789|0'. Returned by ebay_search results.",
		}),
	},
	{ $id: "ItemDetailParams" },
);
export type ItemDetailParams = Static<typeof ItemDetailParams>;

/** Backwards-compat alias kept for any external import. */
export const SearchQuery = BrowseSearchQuery;
export type SearchQuery = BrowseSearchQuery;

/* ============================================================
 * Buy Order API shapes — the public `/v1/buy/order/*` surface
 *
 * Mirrors eBay's Buy Order API (Limited Release on REST). Same
 * surface is served two ways:
 *
 *   1. EBAY_ORDER_API_APPROVED=1 → REST passthrough to api.ebay.com
 *   2. otherwise → flipagent's bridge implementation (Chrome
 *      extension watches the BIN flow and records the resulting order
 *      id; the user clicks BIN + Confirm-and-pay themselves — status
 *      mapped to eBay shape)
 *
 * Multi-stage update endpoints (shipping_address, payment_instrument,
 * coupon) only work in mode 1; bridge mode returns 412 because the
 * extension uses the user's eBay account defaults.
 * ============================================================ */

export const Amount = Type.Object({ value: Type.String(), currency: Type.String() }, { $id: "Amount" });
export type Amount = Static<typeof Amount>;

export const LineItem = Type.Object(
	{
		itemId: Type.String({ description: "eBay legacy item id." }),
		quantity: Type.Integer({ minimum: 1 }),
		variationId: Type.Optional(Type.String()),
	},
	{ $id: "LineItem" },
);
export type LineItem = Static<typeof LineItem>;

export const PricingSummary = Type.Partial(
	Type.Object({
		itemSubtotal: Amount,
		deliveryCost: Amount,
		tax: Amount,
		total: Amount,
	}),
	{ $id: "PricingSummary" },
);
export type PricingSummary = Static<typeof PricingSummary>;

export const InitiateCheckoutSessionRequest = Type.Object(
	{
		lineItems: Type.Array(LineItem, { minItems: 1, maxItems: 10 }),
		// shippingAddresses / paymentInstruments / pricingSummary etc.
		// are accepted but ignored in bridge mode (the extension uses
		// the user's eBay account defaults). Pass-through to REST when
		// `EBAY_ORDER_API_APPROVED=1`.
		shippingAddresses: Type.Optional(Type.Array(Type.Unknown())),
		paymentInstruments: Type.Optional(Type.Array(Type.Unknown())),
		pricingSummary: Type.Optional(PricingSummary),
	},
	{ $id: "InitiateCheckoutSessionRequest" },
);
export type InitiateCheckoutSessionRequest = Static<typeof InitiateCheckoutSessionRequest>;

export const CheckoutSession = Type.Object(
	{
		checkoutSessionId: Type.String(),
		expirationDate: Type.String({ format: "date-time" }),
		lineItems: Type.Array(LineItem),
		pricingSummary: Type.Optional(PricingSummary),
		shippingAddresses: Type.Optional(Type.Array(Type.Unknown())),
		paymentInstruments: Type.Optional(Type.Array(Type.Unknown())),
	},
	{ $id: "CheckoutSession" },
);
export type CheckoutSession = Static<typeof CheckoutSession>;

export const EbayPurchaseOrderStatus = Type.Union(
	[
		Type.Literal("QUEUED_FOR_PROCESSING"),
		Type.Literal("PROCESSING"),
		Type.Literal("PROCESSED"),
		Type.Literal("FAILED"),
		Type.Literal("CANCELED"),
	],
	{ $id: "EbayPurchaseOrderStatus" },
);
export type EbayPurchaseOrderStatus = Static<typeof EbayPurchaseOrderStatus>;

export const EbayPurchaseOrder = Type.Object(
	{
		purchaseOrderId: Type.String(),
		purchaseOrderStatus: EbayPurchaseOrderStatus,
		purchaseOrderCreationDate: Type.String({ format: "date-time" }),
		lineItems: Type.Array(LineItem),
		pricingSummary: Type.Optional(PricingSummary),
		// Surfaced when the bridge implementation completes — eBay's REST
		// shape uses this for the upstream order id; in bridge mode we
		// fill it with the order number scraped from the receipt page.
		ebayOrderId: Type.Optional(Type.String()),
		receiptUrl: Type.Optional(Type.String()),
		failureReason: Type.Optional(Type.String()),
	},
	{ $id: "EbayPurchaseOrder" },
);
export type EbayPurchaseOrder = Static<typeof EbayPurchaseOrder>;
