/**
 * flipagent Listing ↔ eBay InventoryItem + OfferDetails.
 *
 *   ListingCreate → { inventoryItem, offerDetails }   (outbound, write)
 *   { inventoryItem, offer, listingId } → Listing     (inbound, read)
 *
 * Cents-int Money → dollar string at this boundary. Lower-snake
 * `condition` ↔ eBay UPPER_SNAKE. Aspects shape stays
 * `Record<string, string[]>` — eBay accepts that directly. Image array
 * is just URLs both ways.
 */

import type {
	Listing,
	ListingAspects,
	ListingCondition,
	ListingCreate,
	ListingFormat,
	ListingPackage,
	ListingPolicies,
	ListingStatus,
	ListingUpdate,
	Marketplace,
} from "@flipagent/types";
import type {
	InventoryConditionEnum,
	InventoryItem,
	OfferDetails,
	PackageWeightAndSize,
} from "@flipagent/types/ebay/sell";
import { toCents, toDollarString } from "../shared/money.js";

const DEFAULT_MARKETPLACE_ID = "EBAY_US";

const MARKETPLACE_TO_EBAY: Record<Marketplace, string> = {
	ebay: "EBAY_US",
	amazon: "EBAY_US",
	mercari: "EBAY_US",
	poshmark: "EBAY_US",
};

const CONDITION_TO_EBAY: Record<ListingCondition, InventoryConditionEnum> = {
	new: "NEW",
	like_new: "LIKE_NEW",
	new_other: "NEW_OTHER",
	new_with_defects: "NEW_WITH_DEFECTS",
	manufacturer_refurbished: "MANUFACTURER_REFURBISHED",
	certified_refurbished: "CERTIFIED_REFURBISHED",
	excellent_refurbished: "EXCELLENT_REFURBISHED",
	very_good_refurbished: "VERY_GOOD_REFURBISHED",
	good_refurbished: "GOOD_REFURBISHED",
	seller_refurbished: "SELLER_REFURBISHED",
	used_excellent: "USED_EXCELLENT",
	used_very_good: "USED_VERY_GOOD",
	used_good: "USED_GOOD",
	used_acceptable: "USED_ACCEPTABLE",
	for_parts_or_not_working: "FOR_PARTS_OR_NOT_WORKING",
};

const CONDITION_FROM_EBAY = invert(CONDITION_TO_EBAY);

const FORMAT_TO_EBAY: Record<ListingFormat, "FIXED_PRICE" | "AUCTION"> = {
	fixed_price: "FIXED_PRICE",
	auction: "AUCTION",
};

const FORMAT_FROM_EBAY: Record<"FIXED_PRICE" | "AUCTION", ListingFormat> = {
	FIXED_PRICE: "fixed_price",
	AUCTION: "auction",
};

function invert<K extends string, V extends string>(map: Record<K, V>): Record<V, K> {
	const out = {} as Record<V, K>;
	for (const [k, v] of Object.entries(map) as Array<[K, V]>) out[v] = k;
	return out;
}

function packageToEbay(pkg: ListingPackage | undefined): PackageWeightAndSize | undefined {
	if (!pkg) return undefined;
	const out: PackageWeightAndSize = {};
	if (pkg.weight) {
		out.weight = {
			value: pkg.weight.value,
			unit: pkg.weight.unit.toUpperCase() as "POUND" | "OUNCE" | "KILOGRAM" | "GRAM",
		};
	}
	if (pkg.dimensions) {
		out.dimensions = {
			length: pkg.dimensions.length,
			width: pkg.dimensions.width,
			height: pkg.dimensions.height,
			unit: pkg.dimensions.unit.toUpperCase() as "INCH" | "FEET" | "CENTIMETER" | "METER",
		};
	}
	if (pkg.packageType) out.packageType = pkg.packageType;
	return Object.keys(out).length > 0 ? out : undefined;
}

type WeightUnit = "pound" | "ounce" | "kilogram" | "gram";
type DimensionUnit = "inch" | "feet" | "centimeter" | "meter";

function packageFromEbay(pkg: PackageWeightAndSize | undefined): ListingPackage | undefined {
	if (!pkg) return undefined;
	const out: ListingPackage = {};
	if (pkg.weight) {
		out.weight = {
			value: pkg.weight.value,
			unit: pkg.weight.unit.toLowerCase() as WeightUnit,
		};
	}
	if (pkg.dimensions) {
		out.dimensions = {
			length: pkg.dimensions.length,
			width: pkg.dimensions.width,
			height: pkg.dimensions.height,
			unit: pkg.dimensions.unit.toLowerCase() as DimensionUnit,
		};
	}
	if (pkg.packageType) out.packageType = pkg.packageType;
	return Object.keys(out).length > 0 ? out : undefined;
}

export interface OutboundListing {
	inventoryItem: InventoryItem;
	offerDetails: OfferDetails;
	sku: string;
}

/**
 * `ListingCreate` → eBay `InventoryItem` + `OfferDetails` payloads.
 * Caller still needs to PUT the inventory item and POST the offer
 * separately — this function builds the bodies.
 */
export function listingCreateToEbay(
	input: ListingCreate,
	resolved: { sku: string; policies: ListingPolicies; merchantLocationKey: string },
): OutboundListing {
	const inventoryItem: InventoryItem = {
		product: {
			title: input.title,
			...(input.description !== undefined ? { description: input.description } : {}),
			...(input.images.length > 0 ? { imageUrls: input.images } : {}),
			...(input.aspects ? { aspects: input.aspects } : {}),
			...(input.brand ? { brand: input.brand } : {}),
			...(input.mpn ? { mpn: input.mpn } : {}),
			...(input.epid ? { epid: input.epid } : {}),
			...(input.upc ? { upc: input.upc } : input.gtin && /^\d{12}$/.test(input.gtin) ? { upc: [input.gtin] } : {}),
			...(input.ean ? { ean: input.ean } : input.gtin && /^\d{13}$/.test(input.gtin) ? { ean: [input.gtin] } : {}),
			...(input.isbn ? { isbn: input.isbn } : {}),
		},
		condition: CONDITION_TO_EBAY[input.condition],
		...(input.conditionDescription !== undefined ? { conditionDescription: input.conditionDescription } : {}),
		availability: {
			shipToLocationAvailability: { quantity: input.quantity ?? 1 },
			...(input.pickupAtLocation
				? {
						pickupAtLocationAvailability: input.pickupAtLocation.map((p) => ({
							merchantLocationKey: p.merchantLocationKey,
							quantity: p.quantity,
							...(p.availabilityType ? { availabilityType: p.availabilityType } : {}),
						})),
					}
				: {}),
		},
	};
	const pkg = packageToEbay(input.package);
	if (pkg) inventoryItem.packageWeightAndSize = pkg;

	const marketplaceId = input.marketplace ? MARKETPLACE_TO_EBAY[input.marketplace] : DEFAULT_MARKETPLACE_ID;
	const offerDetails: OfferDetails = {
		sku: resolved.sku,
		marketplaceId,
		format: FORMAT_TO_EBAY[input.format ?? "fixed_price"],
		pricingSummary: {
			price: { value: toDollarString(input.price.value), currency: input.price.currency },
		},
		...(input.description !== undefined ? { listingDescription: input.description } : {}),
		categoryId: input.categoryId,
		listingPolicies: resolved.policies,
		merchantLocationKey: resolved.merchantLocationKey,
	};

	return { inventoryItem, offerDetails, sku: resolved.sku };
}

/** Compose patch payloads for `ListingUpdate`. eBay PUT-replaces the inventory item, PUT-updates the offer. */
export interface UpdatePayloads {
	inventoryItem?: InventoryItem;
	offer?: Partial<OfferDetails>;
}

export function listingUpdateToEbay(
	input: ListingUpdate,
	current: { sku: string; condition: ListingCondition; quantity: number },
): UpdatePayloads {
	const out: UpdatePayloads = {};
	const itemTouched = touchesInventoryItem(input);
	if (itemTouched) {
		const product: NonNullable<InventoryItem["product"]> = { title: input.title ?? "" };
		if (input.title === undefined) {
			// eBay's PUT inventory_item replaces — caller must supply title.
			// Leaving empty makes that explicit so we don't silently wipe.
		}
		if (input.description !== undefined) product.description = input.description;
		if (input.images !== undefined) product.imageUrls = input.images;
		if (input.aspects !== undefined) product.aspects = input.aspects;
		const inventoryItem: InventoryItem = {
			product,
			condition: CONDITION_TO_EBAY[current.condition],
			availability: {
				shipToLocationAvailability: { quantity: input.quantity ?? current.quantity },
			},
		};
		if (input.conditionDescription !== undefined) inventoryItem.conditionDescription = input.conditionDescription;
		const pkg = packageToEbay(input.package);
		if (pkg) inventoryItem.packageWeightAndSize = pkg;
		out.inventoryItem = inventoryItem;
	}
	if (input.price !== undefined) {
		out.offer = {
			pricingSummary: { price: { value: toDollarString(input.price.value), currency: input.price.currency } },
		};
	}
	if (input.policies !== undefined) {
		out.offer = { ...(out.offer ?? {}), listingPolicies: input.policies };
	}
	return out;
}

function touchesInventoryItem(u: ListingUpdate): boolean {
	return (
		u.title !== undefined ||
		u.description !== undefined ||
		u.images !== undefined ||
		u.aspects !== undefined ||
		u.conditionDescription !== undefined ||
		u.quantity !== undefined ||
		u.package !== undefined
	);
}

/**
 * Build a flipagent `Listing` from the eBay-side bits. `listingId` is
 * absent until the offer is published. `offerId` is the orchestrator's
 * handle for subsequent updates.
 */
export interface InboundListing {
	sku: string;
	inventoryItem: InventoryItem;
	offer?: { offerId?: string; listing?: { listingId?: string } } & Partial<OfferDetails>;
	createdAt?: string;
	updatedAt?: string;
	marketplace?: Marketplace;
}

export function ebayToListing(parts: InboundListing): Listing {
	const { inventoryItem, offer, sku } = parts;
	const ebayCondition = inventoryItem.condition;
	const condition: ListingCondition = ebayCondition
		? (CONDITION_FROM_EBAY[ebayCondition] ?? "used_good")
		: "used_good";
	const quantity = inventoryItem.availability?.shipToLocationAvailability?.quantity ?? 0;
	const ebayFormat = offer?.format;
	const format: ListingFormat = ebayFormat ? (FORMAT_FROM_EBAY[ebayFormat] ?? "fixed_price") : "fixed_price";

	const listingId = offer?.listing?.listingId ?? "";
	const status: ListingStatus = inferStatus({ listingId, quantity, withdrawn: !!offer?.listing && !listingId });

	const out: Listing = {
		id: listingId,
		sku,
		marketplace: parts.marketplace ?? "ebay",
		status,
		title: inventoryItem.product?.title ?? "",
		price: priceFromOffer(offer),
		quantity,
		condition,
		categoryId: offer?.categoryId ?? "",
		images: inventoryItem.product?.imageUrls ?? [],
		format,
		createdAt: parts.createdAt ?? new Date().toISOString(),
	};
	if (offer?.offerId) out.offerId = offer.offerId;
	if (inventoryItem.product?.description) out.description = inventoryItem.product.description;
	if (inventoryItem.conditionDescription) out.conditionDescription = inventoryItem.conditionDescription;
	if (inventoryItem.product?.aspects) out.aspects = inventoryItem.product.aspects as ListingAspects;
	const pkg = packageFromEbay(inventoryItem.packageWeightAndSize);
	if (pkg) out.package = pkg;
	if (offer?.listingPolicies) out.policies = offer.listingPolicies;
	if (offer?.merchantLocationKey) out.merchantLocationKey = offer.merchantLocationKey;
	if (parts.updatedAt) out.updatedAt = parts.updatedAt;
	if (listingId) out.url = `https://www.ebay.com/itm/${listingId}`;

	// Catalog identifiers — echo back on the inbound shape so callers
	// see what eBay actually stored.
	const product = inventoryItem.product;
	if (product?.brand) out.brand = product.brand;
	if (product?.mpn) out.mpn = product.mpn;
	if (product?.epid) out.epid = product.epid;
	if (product?.upc?.[0]) out.upc = product.upc;
	if (product?.ean?.[0]) out.ean = product.ean;
	if (product?.isbn?.[0]) out.isbn = product.isbn;
	const gtin = product?.upc?.[0] ?? product?.ean?.[0] ?? product?.isbn?.[0];
	if (gtin) out.gtin = gtin;

	return out;
}

function priceFromOffer(offer: InboundListing["offer"]): Listing["price"] {
	const price = offer?.pricingSummary?.price;
	if (!price) return { value: 0, currency: "USD" };
	return {
		value: toCents(price.value),
		currency: price.currency ?? "USD",
	};
}

function inferStatus(input: { listingId: string; quantity: number; withdrawn: boolean }): ListingStatus {
	if (input.withdrawn) return "withdrawn";
	if (!input.listingId) return "draft";
	if (input.quantity === 0) return "out_of_stock";
	return "active";
}
