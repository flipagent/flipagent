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
		width: Type.Optional(Type.Integer()),
		height: Type.Optional(Type.Integer()),
	},
	{ $id: "Image" },
);

export const ShippingOption = Type.Object(
	{
		shippingCost: Type.Optional(Money),
		shippingCostType: Type.Optional(Type.String()),
		/** eBay-defined service slug ("USPSPriority", "eBay shipping to authenticator, then to you", …). */
		shippingServiceCode: Type.Optional(Type.String()),
		/** Carrier label ("USPS", "FedEx", "PSA" for Authenticity Guarantee routing, …). */
		shippingCarrierCode: Type.Optional(Type.String()),
		/** Free-text type label eBay shows in the shipping table ("Standard Shipping", "Expedited"). */
		type: Type.Optional(Type.String()),
		/** Quantity the displayed cost was computed for (eBay caps at 1 for most BIN listings). */
		quantityUsedForEstimate: Type.Optional(Type.Integer()),
		/** ISO 8601 — earliest delivery date eBay's calculator predicts. */
		minEstimatedDeliveryDate: Type.Optional(Type.String()),
		/** ISO 8601 — latest delivery date eBay's calculator predicts. */
		maxEstimatedDeliveryDate: Type.Optional(Type.String()),
	},
	{ $id: "ShippingOption" },
);

/**
 * One region entry inside `shipToLocations.regionIncluded` /
 * `regionExcluded`. eBay uses three region types — `WORLDWIDE`,
 * `WORLD_REGION`, `COUNTRY`, `COUNTRY_REGION` (e.g. "Alaska/Hawaii"),
 * `STATE_OR_PROVINCE` — and identifies them with ISO-3166 codes for
 * `COUNTRY` and proprietary ids otherwise.
 */
export const ShipToRegion = Type.Object(
	{
		regionName: Type.Optional(Type.String()),
		regionType: Type.Optional(Type.String()),
		regionId: Type.Optional(Type.String()),
	},
	{ $id: "ShipToRegion" },
);

/**
 * Cross-border shipping eligibility. `regionIncluded` lists where the
 * seller will ship; `regionExcluded` overrides individual countries
 * inside an included region. To decide if a buyer's country is
 * reachable, walk both arrays — included match minus excluded match.
 */
export const ShipToLocations = Type.Object(
	{
		regionIncluded: Type.Optional(Type.Array(ShipToRegion)),
		regionExcluded: Type.Optional(Type.Array(ShipToRegion)),
	},
	{ $id: "ShipToLocations" },
);

/**
 * Return policy mirror — Browse REST `getItem.returnTerms`. `returnPeriod`
 * is an absolute window the buyer has to initiate a return;
 * `returnShippingCostPayer` decides who eats the return label. eBay
 * additionally returns `refundMethod` ("MONEY_BACK") and
 * `returnMethod` ("REPLACEMENT" | "EXCHANGE" | "MONEY_BACK") on some
 * categories — kept optional.
 */
export const ReturnTerms = Type.Object(
	{
		returnsAccepted: Type.Optional(Type.Boolean()),
		returnPeriod: Type.Optional(
			Type.Object({
				value: Type.Integer(),
				unit: Type.String(),
			}),
		),
		returnShippingCostPayer: Type.Optional(Type.String()),
		refundMethod: Type.Optional(Type.String()),
		returnMethod: Type.Optional(Type.String()),
	},
	{ $id: "ReturnTerms" },
);

/**
 * One element of `paymentMethods[]` on `ItemDetail`. eBay groups card
 * brands under `CREDIT_CARD` / `WALLET` types — the `paymentMethodBrands`
 * array carries individual brand entries (VISA, MASTERCARD, PAYPAL, …).
 */
export const PaymentMethodBrand = Type.Object(
	{
		paymentMethodBrandType: Type.Optional(Type.String()),
		logoImage: Type.Optional(Image),
	},
	{ $id: "PaymentMethodBrand" },
);

export const PaymentMethod = Type.Object(
	{
		paymentMethodType: Type.Optional(Type.String()),
		paymentMethodBrands: Type.Optional(Type.Array(PaymentMethodBrand)),
	},
	{ $id: "PaymentMethod" },
);
export type PaymentMethod = Static<typeof PaymentMethod>;
export type ShipToLocations = Static<typeof ShipToLocations>;
export type ReturnTerms = Static<typeof ReturnTerms>;
export type PrimaryItemGroup = Static<typeof PrimaryItemGroup>;

/**
 * Multi-variation parent metadata. Detail responses for a SKU of a
 * variation listing carry the full group metadata so the caller can
 * jump to siblings without an extra `getItemsByItemGroup` call.
 */
export const PrimaryItemGroup = Type.Object(
	{
		itemGroupId: Type.Optional(Type.String()),
		itemGroupType: Type.Optional(Type.String()),
		itemGroupHref: Type.Optional(Type.String()),
		itemGroupTitle: Type.Optional(Type.String()),
		itemGroupImage: Type.Optional(Image),
		itemGroupAdditionalImages: Type.Optional(Type.Array(Image)),
	},
	{ $id: "PrimaryItemGroup" },
);

/**
 * One row of the `taxes[]` array. eBay collects-and-remits sales tax
 * on most US destinations — each row carries the jurisdiction, the
 * tax type, and whether shipping/handling was taxed.
 */
export const TaxJurisdiction = Type.Object(
	{
		region: Type.Optional(
			Type.Object({
				regionName: Type.Optional(Type.String()),
				regionType: Type.Optional(Type.String()),
			}),
		),
		taxJurisdictionId: Type.Optional(Type.String()),
	},
	{ $id: "TaxJurisdiction" },
);

export const Tax = Type.Object(
	{
		taxJurisdiction: Type.Optional(TaxJurisdiction),
		taxType: Type.Optional(Type.String()),
		shippingAndHandlingTaxed: Type.Optional(Type.Boolean()),
		includedInPrice: Type.Optional(Type.Boolean()),
		ebayCollectAndRemitTax: Type.Optional(Type.Boolean()),
		taxPercentage: Type.Optional(Type.String()),
	},
	{ $id: "Tax" },
);

/**
 * Marketing price block — Browse REST `getItem.marketingPrice`. eBay
 * surfaces this when the seller advertises a discount: original (struck-
 * through) price plus the resulting discount amount and percentage.
 * `priceTreatment` is eBay's enum (`MINIMUM_ADVERTISED_PRICE`,
 * `LIST_PRICE`, `STRIKETHROUGH`, `MARKDOWN`, …) describing how the
 * "compare-at" price is justified.
 */
export const MarketingPrice = Type.Object(
	{
		originalPrice: Type.Optional(Money),
		discountAmount: Type.Optional(Money),
		discountPercentage: Type.Optional(Type.String()),
		priceTreatment: Type.Optional(Type.String()),
	},
	{ $id: "MarketingPrice" },
);

/**
 * Structured condition descriptor row — Browse REST exposes these under
 * `conditionDescriptors[]` for graded categories (PSA grade, BGS rating,
 * professional grader, certification number) and a few other condition-
 * heavy verticals (CPU brand on used computers, etc.). Generic
 * `name + values[].content` pairs.
 */
export const ConditionDescriptor = Type.Object(
	{
		name: Type.Optional(Type.String()),
		values: Type.Optional(
			Type.Array(
				Type.Object({
					content: Type.Optional(Type.String()),
				}),
			),
		),
	},
	{ $id: "ConditionDescriptor" },
);

/**
 * Catalog product review aggregate — Browse REST
 * `primaryProductReviewRating`. Present when the listing is linked to an
 * eBay catalog product (ePID) and the product has community reviews.
 */
export const ProductReviewRating = Type.Object(
	{
		reviewCount: Type.Optional(Type.Integer()),
		averageRating: Type.Optional(Type.String()),
		ratingHistograms: Type.Optional(
			Type.Array(
				Type.Object({
					rating: Type.String(),
					count: Type.Integer(),
				}),
			),
		),
	},
	{ $id: "ProductReviewRating" },
);

/**
 * One element of `warnings[]` — Browse REST emits these for soft errors
 * (couldn't compute shipping cost, calculator timed out, etc.) without
 * failing the whole response. Same shape eBay uses for its top-level
 * `errors[]` envelope so callers can reuse error-handling code.
 */
export const Warning = Type.Object(
	{
		errorId: Type.Optional(Type.Integer()),
		domain: Type.Optional(Type.String()),
		category: Type.Optional(Type.String()),
		message: Type.Optional(Type.String()),
		parameters: Type.Optional(
			Type.Array(
				Type.Object({
					name: Type.Optional(Type.String()),
					value: Type.Optional(Type.String()),
				}),
			),
		),
	},
	{ $id: "Warning" },
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
 * JSON body don't have to inspect headers. `"scrape"` = vendor-fetched page
 * parsed by `@flipagent/ebay-scraper` (keyword SRP HTML or category-browse
 * hydration JSON, depending on the call); `"rest"` = eBay REST passthrough
 * (Insights-approved tenants); `"cache:*"` = served from the response cache.
 * Optional for forward compatibility with pre-source-field clients; fresh
 * responses always set it.
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
		/** "SHIP_TO_HOME", "PICKUP_DROP_OFF", "DIGITAL_DELIVERY", … */
		deliveryOptions: Type.Optional(Type.Array(Type.String())),
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
		/** Top-level promotion of `localizedAspects` "Color". Browse REST exposes both. */
		color: Type.Optional(Type.String()),
		/** Top-level promotion of `localizedAspects` "Size". Browse REST exposes both. */
		size: Type.Optional(Type.String()),
		/** Top-level promotion of `localizedAspects` "Pattern". Browse REST exposes both. */
		pattern: Type.Optional(Type.String()),
		/** Top-level promotion of `localizedAspects` "Material". Browse REST exposes both. */
		material: Type.Optional(Type.String()),
		/** Top-level promotion of `localizedAspects` "Size Type" ("Regular", "Big & Tall"). */
		sizeType: Type.Optional(Type.String()),
		/** Top-level promotion of `localizedAspects` "MPN" — Manufacturer Part Number. */
		mpn: Type.Optional(Type.String()),
		/** Top-level promotion of `localizedAspects` "UPC" / "EAN" / "ISBN". */
		gtin: Type.Optional(Type.String()),
		/** eBay catalog product id (ePID) — same identifier carried on `ItemSummary`. */
		epid: Type.Optional(Type.String()),
		/**
		 * Number of physical items in the listing — eBay treats this as a
		 * top-level field separate from quantity. `0` is the default
		 * REST emits for non-lot listings; we stay narrow on scrape and
		 * leave it absent unless a "Lot" aspect surfaces.
		 */
		lotSize: Type.Optional(Type.Integer()),
		/** Per-buyer purchase limit eBay enforces at checkout. */
		quantityLimitPerBuyer: Type.Optional(Type.Integer()),
		/** Long-form condition note from the seller (above-and-beyond `condition`). */
		conditionDescription: Type.Optional(Type.String()),
		/** Structured condition descriptor rows — graded card grade, certification number, etc. */
		conditionDescriptors: Type.Optional(Type.Array(ConditionDescriptor)),
		/** Strikethrough / list price + discount metadata when the listing advertises a markdown. */
		marketingPrice: Type.Optional(MarketingPrice),
		/** Catalog product review aggregate (ePID-linked listings). */
		primaryProductReviewRating: Type.Optional(ProductReviewRating),
		/** Soft errors eBay tagged on the response (shipping calculator failures, etc.). */
		warnings: Type.Optional(Type.Array(Warning)),
		topRatedBuyingExperience: Type.Optional(Type.Boolean()),
		/**
		 * eBay programs the listing qualifies for —
		 * `"AUTHENTICITY_GUARANTEE"`, `"EBAY_REFURBISHED"`, `"EBAY_PLUS"`, etc.
		 * Browse REST emits this on detail (not on item_summary cards), so
		 * scoring that wants to split AG vs non-AG comps has to enrich at
		 * detail level. Mirrored 1:1 from eBay.
		 */
		qualifiedPrograms: Type.Optional(Type.Array(Type.String())),
		/**
		 * Authenticity Guarantee block — present on listings where eBay
		 * routes the item through a third-party authenticator before
		 * delivery. Sneakers, handbags, watches, trading cards, fine
		 * jewelry. Mirror of Browse REST `getItem.authenticityGuarantee`.
		 */
		authenticityGuarantee: Type.Optional(
			Type.Object({
				termsWebUrl: Type.Optional(Type.String()),
				description: Type.Optional(Type.String()),
			}),
		),
		/** Paid-placement boost flag (Promoted Listings). Browse REST detail-only. */
		priorityListing: Type.Optional(Type.Boolean()),
		image: Type.Optional(Image),
		additionalImages: Type.Optional(Type.Array(Image)),
		estimatedAvailabilities: Type.Optional(Type.Array(EstimatedAvailability)),
		/** Cross-border eligibility — used by buyers / forwarders to filter at search time. */
		shipToLocations: Type.Optional(ShipToLocations),
		/** Return policy in eBay shape. Both REST and scrape populate this; SDK consumers read it directly. */
		returnTerms: Type.Optional(ReturnTerms),
		/** State-by-state collect-and-remit tax rows (US destinations). */
		taxes: Type.Optional(Type.Array(Tax)),
		/** Accepted payment instruments — drives the Buy Order eligibility prompt. */
		paymentMethods: Type.Optional(Type.Array(PaymentMethod)),
		/** Buyer must pay immediately on Buy It Now (no checkout cart hold). */
		immediatePay: Type.Optional(Type.Boolean()),
		/** Eligible for guest checkout (no eBay account required to buy). */
		enabledForGuestCheckout: Type.Optional(Type.Boolean()),
		/** Eligible for the in-line BIN button (vs. classic two-step checkout). */
		eligibleForInlineCheckout: Type.Optional(Type.Boolean()),
		/** Restricted to adult buyers — same flag eBay surfaces on summary cards. */
		adultOnly: Type.Optional(Type.Boolean()),
		/** At least one coupon offer is active against the listing. */
		availableCoupons: Type.Optional(Type.Boolean()),
		/** Multi-variation parent metadata — group id, type, title, hero images. */
		primaryItemGroup: Type.Optional(PrimaryItemGroup),
		/** Per-unit price ("$0.50 / Fl Oz") for grocery / supplement listings. */
		unitPrice: Type.Optional(Money),
		/** Unit label paired with `unitPrice` ("Unit", "Fl Oz", "Count"). */
		unitPricingMeasure: Type.Optional(Type.String()),
	},
	{ $id: "ItemDetail" },
);
export type ItemDetail = Static<typeof ItemDetail>;

/* -------------------------- request param schemas -------------------------- */

/**
 * Query parameters for /buy/browse/v1/item_summary/search.
 *
 * Per eBay's spec, the request must carry **at least one** of `q`,
 * `category_ids`, `gtin`, or `epid` (or any combination). The route
 * layer enforces that rule explicitly so the error message is helpful;
 * the schema itself marks all four optional.
 *
 * `category_ids` (and the other identifiers) feed the anonymized query
 * pulse on every call regardless of source, so `/v1/trends/categories`
 * can rank demand once enough data accrues.
 */
export const BrowseSearchQuery = Type.Object(
	{
		q: Type.Optional(
			Type.String({
				description:
					"Search keywords. Optional when category_ids / gtin / epid is provided (eBay requires at least one).",
			}),
		),
		category_ids: Type.Optional(
			Type.String({
				description:
					"Pipe-joined Browse category ids, e.g. '15709|175672'. Forwarded verbatim to all sources; recorded on the demand-pulse archive in all cases.",
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

/* ============================================================
 * Buy Order API shapes — eBay-side wire shapes for the buy flow.
 *
 * Mirrors eBay's Buy Order API (Limited Release on REST). Used
 * internally by the `/v1/purchases` resource service to model the
 * upstream wire payload; both transports produce these shapes:
 *
 *   1. EBAY_ORDER_API_APPROVED=1 → REST passthrough to api.ebay.com
 *   2. otherwise → flipagent's bridge implementation (Chrome
 *      extension watches the BIN flow and records the resulting order
 *      id; the user clicks BIN + Confirm-and-pay themselves)
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
