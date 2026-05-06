/**
 * eBay-shape → flipagent-shape transformer for `/v1/items/*`.
 *
 *   ItemSummary  →  Item
 *   ItemDetail   →  Item (with richer aspects + description-derived fields)
 *
 * Boundary rule: dollar strings → cents-int Money happens here. Snake-case
 * field renames happen here. Image arrays consolidate here. Once converted,
 * downstream code (SDK consumers, MCP tools, playground UI) sees the
 * normalized shape.
 *
 * Reverse mapping (id → eBay v1|...|0 form) lives in `id.ts` so the
 * transformer stays one-way and pure.
 */

import type {
	Item,
	ItemBidding,
	ItemCategory,
	ItemConditionDescriptor,
	ItemLocation,
	ItemMarketingPrice,
	ItemReturnTerms,
	ItemSeller,
	ItemShipping,
} from "@flipagent/types";
import type { ItemDetail, ItemSummary, LocalizedAspect } from "@flipagent/types/ebay/buy";
import { moneyFrom, toCents } from "../shared/money.js";

/**
 * Strip eBay's `v1|`-prefixed envelope so the wire id is the bare numeric
 * legacyItemId — that's the form used in `ebay.com/itm/...` URLs and the
 * one humans/agents naturally paste. The v1|...|0 form is reconstructed
 * on the way back out (see `id.ts`).
 */
function bareId(itemId: string, legacyItemId?: string): string {
	if (legacyItemId) return legacyItemId;
	const m = itemId.match(/^v1\|(\d+)\|/);
	return m ? m[1] : itemId;
}

/**
 * Pull a multi-quantity listing's rolling sold count from either eBay
 * shape. ItemDetail surfaces it under `estimatedAvailabilities[0]`
 * (Browse REST detail), ItemSummary under `totalSoldQuantity` (Browse
 * REST search). Same number, two homes — preference is `totalSoldQuantity`
 * when present (search summaries are the cheaper source). Returns null
 * when neither populated.
 *
 * Shared between `transform.ts` (mapping into the public `Item` shape)
 * and `evaluate/adapter.ts` (feeding the seed velocity blend), so both
 * read from the same single source of truth.
 */
export function rollingSoldCount(item: ItemSummary | ItemDetail): number | null {
	const fromSummary = "totalSoldQuantity" in item && item.totalSoldQuantity != null ? item.totalSoldQuantity : null;
	if (fromSummary != null) return fromSummary;
	const fromDetail =
		"estimatedAvailabilities" in item ? item.estimatedAvailabilities?.[0]?.estimatedSoldQuantity : undefined;
	return fromDetail != null ? fromDetail : null;
}

/**
 * Live remaining stock from `estimatedAvailabilities[0]`. Only
 * ItemDetail carries this; ItemSummary returns null. Distinct from
 * `rollingSoldCount` because the two answer different questions:
 * "how many shipped?" vs "how many left?".
 */
function remainingStock(item: ItemSummary | ItemDetail): number | null {
	if (!("estimatedAvailabilities" in item)) return null;
	const q = item.estimatedAvailabilities?.[0]?.estimatedAvailableQuantity;
	return q != null ? q : null;
}

function seller(s: ItemSummary["seller"]): ItemSeller | undefined {
	if (!s?.username) return undefined;
	return {
		username: s.username,
		feedbackScore: s.feedbackScore ?? undefined,
		feedbackPercentage: s.feedbackPercentage ?? undefined,
	};
}

function location(loc: ItemSummary["itemLocation"]): ItemLocation | undefined {
	if (!loc) return undefined;
	const out: ItemLocation = {};
	if (loc.city) out.city = loc.city;
	if (loc.stateOrProvince) out.region = loc.stateOrProvince;
	if (loc.postalCode) out.postalCode = loc.postalCode;
	if (loc.country) out.country = loc.country;
	return Object.keys(out).length > 0 ? out : undefined;
}

function category(item: ItemSummary | ItemDetail): ItemCategory | undefined {
	if (!item.categoryId) return undefined;
	const out: ItemCategory = { id: item.categoryId };
	if ("categoryPath" in item && item.categoryPath) out.path = item.categoryPath;
	return out;
}

function aspectsFromArray(arr: ReadonlyArray<LocalizedAspect> | undefined): Item["aspects"] {
	if (!arr || arr.length === 0) return undefined;
	const out: Record<string, string> = {};
	for (const a of arr) {
		if (a.name && a.value) out[a.name] = a.value;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function buyingOptions(opts: ItemSummary["buyingOptions"]): Item["buyingOptions"] {
	if (!opts || opts.length === 0) return undefined;
	const out: NonNullable<Item["buyingOptions"]> = [];
	for (const o of opts) {
		if (o === "AUCTION") out.push("auction");
		else if (o === "FIXED_PRICE") out.push("fixed_price");
		else if (o === "BEST_OFFER") out.push("best_offer");
	}
	return out.length > 0 ? out : undefined;
}

function bidding(item: ItemSummary | ItemDetail): ItemBidding | undefined {
	const count = item.bidCount;
	if (count === undefined || count === null) return undefined;
	return {
		count,
		currentBid: moneyFrom(item.currentBidPrice),
	};
}

function marketingPrice(item: ItemSummary | ItemDetail): ItemMarketingPrice | undefined {
	if (!("marketingPrice" in item) || !item.marketingPrice) return undefined;
	const mp = item.marketingPrice;
	const out: ItemMarketingPrice = {};
	if (mp.originalPrice) out.originalPrice = moneyFrom(mp.originalPrice);
	if (mp.discountAmount) out.discountAmount = moneyFrom(mp.discountAmount);
	if (mp.discountPercentage) out.discountPercentage = mp.discountPercentage;
	if (mp.priceTreatment) out.priceTreatment = mp.priceTreatment;
	return Object.keys(out).length > 0 ? out : undefined;
}

function returnTermsOf(item: ItemSummary | ItemDetail): ItemReturnTerms | undefined {
	if (!("returnTerms" in item) || !item.returnTerms) return undefined;
	const r = item.returnTerms;
	const out: ItemReturnTerms = {};
	if (r.returnsAccepted !== undefined) out.accepted = r.returnsAccepted;
	if (r.returnPeriod?.value !== undefined) out.periodDays = r.returnPeriod.value;
	if (r.returnShippingCostPayer === "BUYER" || r.returnShippingCostPayer === "SELLER") {
		out.shippingCostPayer = r.returnShippingCostPayer.toLowerCase() as "buyer" | "seller";
	}
	if (r.refundMethod) out.refundMethod = r.refundMethod;
	if (r.returnMethod) out.returnMethod = r.returnMethod;
	return Object.keys(out).length > 0 ? out : undefined;
}

function paymentMethodsOf(item: ItemSummary | ItemDetail): string[] | undefined {
	if (!("paymentMethods" in item) || !item.paymentMethods) return undefined;
	const types = item.paymentMethods.map((p) => p.paymentMethodType).filter((t): t is string => !!t);
	return types.length > 0 ? Array.from(new Set(types)) : undefined;
}

function conditionDescriptorsOf(item: ItemSummary | ItemDetail): ItemConditionDescriptor[] | undefined {
	if (!("conditionDescriptors" in item) || !item.conditionDescriptors) return undefined;
	const out: ItemConditionDescriptor[] = [];
	for (const cd of item.conditionDescriptors) {
		if (!cd.name) continue;
		const values = (cd.values ?? []).map((v) => v.content).filter((s): s is string => !!s);
		out.push({ name: cd.name, values });
	}
	return out.length > 0 ? out : undefined;
}

function shipsToFromLocations(item: ItemSummary | ItemDetail): { shipsTo?: string[]; shipsToExcluded?: string[] } {
	if (!("shipToLocations" in item) || !item.shipToLocations) return {};
	const incl: string[] = [];
	const excl: string[] = [];
	for (const r of item.shipToLocations.regionIncluded ?? []) {
		const v = r.regionName ?? r.regionId;
		if (v) incl.push(v);
	}
	for (const r of item.shipToLocations.regionExcluded ?? []) {
		const v = r.regionName ?? r.regionId;
		if (v) excl.push(v);
	}
	return { ...(incl.length ? { shipsTo: incl } : {}), ...(excl.length ? { shipsToExcluded: excl } : {}) };
}

function shipping(item: ItemSummary | ItemDetail): ItemShipping | undefined {
	const opts = item.shippingOptions ?? [];
	if (opts.length === 0) return undefined;
	let cheapest: number | undefined;
	let currency: string | undefined;
	let free = false;
	let earliestFrom: string | undefined;
	let earliestTo: string | undefined;
	for (const o of opts) {
		const c = o.shippingCost;
		if (c?.value !== undefined) {
			const cents = toCents(c.value);
			if (cents === 0) free = true;
			if (cheapest === undefined || cents < cheapest) {
				cheapest = cents;
				currency = c.currency ?? "USD";
			}
		} else if (o.shippingCostType === "FREE") {
			free = true;
			if (cheapest === undefined) cheapest = 0;
		}
		if (o.minEstimatedDeliveryDate && (!earliestFrom || o.minEstimatedDeliveryDate < earliestFrom)) {
			earliestFrom = o.minEstimatedDeliveryDate;
		}
		if (o.maxEstimatedDeliveryDate && (!earliestTo || o.maxEstimatedDeliveryDate < earliestTo)) {
			earliestTo = o.maxEstimatedDeliveryDate;
		}
	}
	const out: ItemShipping = {};
	if (cheapest !== undefined) out.cost = { value: cheapest, currency: currency ?? "USD" };
	if (free) out.free = true;
	if (earliestFrom) out.estimatedDeliveryFrom = earliestFrom;
	if (earliestTo) out.estimatedDeliveryTo = earliestTo;
	return Object.keys(out).length > 0 ? out : undefined;
}

function imagesOf(item: ItemSummary | ItemDetail): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const push = (url: string | undefined) => {
		if (!url || seen.has(url)) return;
		seen.add(url);
		out.push(url);
	};
	push(item.image?.imageUrl);
	if ("thumbnailImages" in item) {
		for (const t of item.thumbnailImages ?? []) push(t.imageUrl);
	}
	if ("additionalImages" in item) {
		for (const a of item.additionalImages ?? []) push(a.imageUrl);
	}
	return out;
}

function inferStatus(item: ItemSummary | ItemDetail): Item["status"] {
	if ("lastSoldDate" in item && (item.lastSoldDate || item.lastSoldPrice)) return "sold";
	if (item.itemEndDate) {
		const end = Date.parse(item.itemEndDate);
		if (Number.isFinite(end) && end < Date.now()) return "ended";
	}
	return "active";
}

/**
 * Pick the `aspects` source. ItemDetail carries `localizedAspects[]` —
 * the structured grid. ItemSummary doesn't expose item-specifics
 * directly (eBay search-page renders only top-level promotions like
 * `brand`/`color`), so we synthesize a minimal aspects map from those
 * top-level fields when they're present.
 */
function aspectsOf(item: ItemSummary | ItemDetail): Item["aspects"] {
	if ("localizedAspects" in item) {
		const fromList = aspectsFromArray(item.localizedAspects);
		if (fromList) return fromList;
	}
	const synth: Record<string, string> = {};
	if ("brand" in item && item.brand) synth.Brand = item.brand;
	if ("color" in item && item.color) synth.Color = item.color;
	if ("size" in item && item.size) synth.Size = item.size;
	if ("material" in item && item.material) synth.Material = item.material;
	if ("pattern" in item && item.pattern) synth.Pattern = item.pattern;
	if ("mpn" in item && item.mpn) synth.MPN = item.mpn;
	return Object.keys(synth).length > 0 ? synth : undefined;
}

/**
 * Convert eBay `ItemSummary` (search hit) or `ItemDetail` (single fetch)
 * to flipagent `Item`. Optional fields collapse cleanly — empty objects
 * are dropped so the JSON stays small.
 */
export function ebayItemToFlipagent(item: ItemSummary | ItemDetail): Item {
	const status = inferStatus(item);
	const out: Item = {
		id: bareId(item.itemId, item.legacyItemId),
		marketplace: "ebay_us",
		status,
		title: item.title,
		url: item.itemWebUrl,
		images: imagesOf(item),
	};
	const price = moneyFrom(item.price);
	if (price) out.price = price;
	if (item.condition) out.condition = item.condition;
	if (item.conditionId) out.conditionId = item.conditionId;
	const s = seller(item.seller);
	if (s) out.seller = s;
	const cat = category(item);
	if (cat) out.category = cat;
	const asp = aspectsOf(item);
	if (asp) out.aspects = asp;
	const bo = buyingOptions(item.buyingOptions);
	if (bo) out.buyingOptions = bo;

	// active-only
	if (item.itemEndDate) out.endsAt = item.itemEndDate;
	if (item.itemCreationDate) out.createdAt = item.itemCreationDate;
	if (item.watchCount !== undefined && item.watchCount !== null) out.watchCount = item.watchCount;
	const bid = bidding(item);
	if (bid) out.bidding = bid;

	// Rolling sold count + live remaining stock — surfaces on active
	// listings (PDP availability + search summaries) and sold comps. Both
	// extractors centralised in helpers above so `evaluate/adapter.ts` reads
	// from the same source.
	const sold = rollingSoldCount(item);
	if (sold != null) out.soldQuantity = sold;
	const remaining = remainingStock(item);
	if (remaining != null) out.availableQuantity = remaining;

	// sold-only — only populated on ItemSummary (Marketplace Insights merge)
	if ("lastSoldDate" in item) {
		if (item.lastSoldDate) out.soldAt = item.lastSoldDate;
		const sold = moneyFrom(item.lastSoldPrice);
		if (sold) out.soldPrice = sold;
	}

	const ship = shipping(item);
	const regions = shipsToFromLocations(item);
	if (ship || regions.shipsTo || regions.shipsToExcluded) {
		out.shipping = { ...(ship ?? {}), ...regions };
	}
	const loc = location(item.itemLocation);
	if (loc) out.location = loc;

	const mp = marketingPrice(item);
	if (mp) out.marketingPrice = mp;
	const rt = returnTermsOf(item);
	if (rt) out.returnTerms = rt;
	const pm = paymentMethodsOf(item);
	if (pm) out.paymentMethods = pm;
	const cd = conditionDescriptorsOf(item);
	if (cd) out.conditionDescriptors = cd;
	if ("topRatedBuyingExperience" in item && item.topRatedBuyingExperience !== undefined) {
		out.topRatedBuyingExperience = item.topRatedBuyingExperience;
	}
	if (
		"authenticityGuarantee" in item &&
		item.authenticityGuarantee !== null &&
		item.authenticityGuarantee !== undefined
	) {
		out.authenticityGuarantee = !!item.authenticityGuarantee;
	}
	if ("adultOnly" in item && item.adultOnly !== undefined) out.adultOnly = !!item.adultOnly;
	if ("availableCoupons" in item && item.availableCoupons !== undefined)
		out.availableCoupons = !!item.availableCoupons;
	if ("qualifiedPrograms" in item && Array.isArray(item.qualifiedPrograms)) {
		out.qualifiedPrograms = item.qualifiedPrograms as string[];
	}
	if ("lotSize" in item && item.lotSize !== undefined && item.lotSize !== null) out.lotSize = item.lotSize;
	if (
		"quantityLimitPerBuyer" in item &&
		item.quantityLimitPerBuyer !== undefined &&
		item.quantityLimitPerBuyer !== null
	) {
		out.quantityLimitPerBuyer = item.quantityLimitPerBuyer;
	}

	if (item.epid) out.epid = item.epid;
	if (item.gtin) out.gtin = item.gtin;
	if ("mpn" in item && item.mpn) out.mpn = item.mpn;

	const groupId = "primaryItemGroup" in item ? item.primaryItemGroup?.itemGroupId : undefined;
	if (groupId) out.groupId = groupId;

	return out;
}
