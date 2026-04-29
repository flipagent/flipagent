import {
	endDateFromTimeLeft,
	extractEbayDetail,
	extractEbayItems,
	normalizeBuyingFormat,
	parseBidCount,
	parseEbayPrice,
	parseEbayShipping,
	parseFeedbackScore,
	parseSellerInfo,
	parseSoldQuantity,
	parseWatchCount,
	type RawEbayDetail,
	splitSubtitle,
} from "./ebay-extract.js";

const BASE_URL = "https://www.ebay.com";

export interface EbaySearchParams {
	keyword: string;
	/** When true, only sold/completed listings. */
	soldOnly?: boolean;
	/** When true, only auctions. Mapped to `LH_Auction=1`. */
	auctionOnly?: boolean;
	/** When true, only Buy-It-Now. Mapped to `LH_BIN=1`. */
	binOnly?: boolean;
	/** Sort key: endingSoonest, newlyListed, pricePlusShippingLowest, pricePlusShippingHighest. */
	sort?: "endingSoonest" | "newlyListed" | "pricePlusShippingLowest" | "pricePlusShippingHighest";
	/**
	 * eBay condition codes (`1000` New, `2000` MFG Refurb, `3000` Used,
	 * `7000` Parts, etc). Pipe-joined into `LH_ItemCondition=a|b|...` —
	 * eBay's web search uses the same numeric enum as the Browse API
	 * `conditionIds:{...}` filter, so callers can pass either through.
	 */
	conditionIds?: string[];
	pages?: number;
}

/**
 * Mirror of the eBay Browse `ItemSummary` shape, augmented with the
 * sold-only fields from Marketplace Insights `getItemSales`. Optional
 * fields stay absent when the source page doesn't carry them — we do
 * not fake values, and we do not add flipagent-specific fields. Strict
 * eBay parity: code written against eBay's published Browse /
 * Marketplace Insights TypeScript shapes drops in.
 */
export interface EbayItemSummary {
	/** Browse-shape id, `v1|<numeric>|0`. */
	itemId: string;
	/** Bare numeric id — same value Browse exposes as `legacyItemId`. */
	legacyItemId?: string;
	title: string;
	itemWebUrl: string;
	condition?: string;
	conditionId?: string;
	price?: { value: string; currency: string };
	currentBidPrice?: { value: string; currency: string };
	lastSoldPrice?: { value: string; currency: string };
	shippingOptions?: { shippingCost?: { value: string; currency: string } }[];
	buyingOptions?: ("AUCTION" | "FIXED_PRICE")[];
	bidCount?: number;
	watchCount?: number;
	itemEndDate?: string;
	lastSoldDate?: string;
	totalSoldQuantity?: number;
	image?: { imageUrl: string };
	thumbnailImages?: { imageUrl: string }[];
	seller?: { username?: string; feedbackPercentage?: string; feedbackScore?: number };
	topRatedBuyingExperience?: boolean;
}

/**
 * Mirror of the eBay Browse API `SearchPagedCollection` envelope. Active
 * searches populate `itemSummaries`; sold searches populate `itemSales`.
 */
export interface BrowseSearchResponse {
	itemSummaries?: EbayItemSummary[];
	itemSales?: EbayItemSummary[];
	total?: number;
}

const SORT_MAP: Record<NonNullable<EbaySearchParams["sort"]>, string> = {
	endingSoonest: "1",
	newlyListed: "10",
	pricePlusShippingLowest: "15",
	pricePlusShippingHighest: "16",
};

export function buildEbayUrl(params: EbaySearchParams, page: number): string {
	const u = new URL(`${BASE_URL}/sch/i.html`);
	u.searchParams.set("_nkw", params.keyword);
	// Note: `_sacat=0` (any category) used to be set here. eBay's robots.txt
	// v26.2_COM_April_2026 added `Disallow: /sch/*_sacat=` under
	// User-agent: *, so we omit the param — `_sacat` is the default-any
	// behaviour anyway, results are identical without it.
	u.searchParams.set("_pgn", String(page));
	if (params.soldOnly) {
		u.searchParams.set("LH_Sold", "1");
		u.searchParams.set("LH_Complete", "1");
	}
	if (params.auctionOnly) u.searchParams.set("LH_Auction", "1");
	if (params.binOnly) u.searchParams.set("LH_BIN", "1");
	if (params.conditionIds && params.conditionIds.length > 0) {
		u.searchParams.set("LH_ItemCondition", params.conditionIds.join("|"));
	}
	if (params.sort) u.searchParams.set("_sop", SORT_MAP[params.sort]);
	return u.toString();
}

function parseSoldDate(text: string | null): Date | null {
	if (!text) return null;
	const monthMap: Record<string, number> = {
		jan: 0,
		feb: 1,
		mar: 2,
		apr: 3,
		may: 4,
		jun: 5,
		jul: 6,
		aug: 7,
		sep: 8,
		oct: 9,
		nov: 10,
		dec: 11,
	};
	const us = text.match(/([A-Za-z]{3,})\.?\s*(\d{1,2}),\s*(\d{4})/);
	if (us) {
		const [, monthStr, day, year] = us;
		const m = monthMap[(monthStr ?? "").toLowerCase().slice(0, 3)];
		if (m !== undefined) {
			return new Date(Date.UTC(Number.parseInt(year ?? "0", 10), m, Number.parseInt(day ?? "0", 10)));
		}
	}
	const eu = text.match(/(\d{1,2})\.?\s*([A-Za-z]+)\s*(\d{4})/);
	if (eu) {
		const [, day, monthStr, year] = eu;
		const m = monthMap[(monthStr ?? "").toLowerCase().slice(0, 3)];
		if (m !== undefined) {
			return new Date(Date.UTC(Number.parseInt(year ?? "0", 10), m, Number.parseInt(day ?? "0", 10)));
		}
	}
	return null;
}

function centsToValue(cents: number | null): string | undefined {
	if (cents == null) return undefined;
	return (cents / 100).toFixed(2);
}

export function parseEbaySearchHtml(
	html: string,
	params: EbaySearchParams,
	domFactory: (html: string) => ParentNode,
): EbayItemSummary[] {
	const root = domFactory(html);
	const raw = extractEbayItems(root);
	const now = Date.now();
	const out: EbayItemSummary[] = [];
	for (const r of raw) {
		if (!r.itemIdHint) continue;
		const price = parseEbayPrice(r.priceText);
		const shipping = parseEbayShipping(r.shippingText);
		const buying = normalizeBuyingFormat(r.buyingFormat);
		const subtitle = splitSubtitle(r.subtitleText);

		const item: EbayItemSummary = {
			itemId: `v1|${r.itemIdHint}|0`,
			legacyItemId: r.itemIdHint,
			title: r.title,
			itemWebUrl: r.url,
		};
		if (r.topRatedBuyingExperience) item.topRatedBuyingExperience = true;
		if (subtitle.condition) item.condition = subtitle.condition;
		if (subtitle.conditionId) item.conditionId = subtitle.conditionId;
		// `itemAttributes` (sub-SKU descriptors from the subtitle tail) is
		// dropped from the wire shape — Marketplace Insights doesn't
		// expose it. The structured equivalent lives on the detail-side
		// `localizedAspects`.

		if (shipping != null)
			item.shippingOptions = [{ shippingCost: { value: centsToValue(shipping)!, currency: price.currency } }];
		const bid = parseBidCount(r.bidCountText);
		if (bid != null) item.bidCount = bid;
		// eBay SRP cards don't always carry an "auction" / "buy it now"
		// attribute row — `auctionOnly` searches in particular drop the
		// label since the buying-format is implied. The presence of a
		// bidCount line is the load-bearing signal: only auction listings
		// surface bid counts on the SRP. Fall back to the explicit
		// `buyingFormat` when no bid count was parsed (zero-bid auctions
		// just out of the gate, fixed-price-with-best-offer rows, etc.).
		const inferredBuying: "AUCTION" | "FIXED_PRICE" | undefined = bid != null ? "AUCTION" : (buying ?? undefined);
		if (inferredBuying) item.buyingOptions = [inferredBuying];

		if (price.cents != null) {
			const money = { value: centsToValue(price.cents)!, currency: price.currency };
			item.price = money;
			// Marketplace Insights surfaces the realized sale separately as
			// `lastSoldPrice`. For sold rows we mirror the value so callers
			// can read either field.
			if (params.soldOnly) item.lastSoldPrice = money;
			// Browse REST mirrors the auction current high bid into both
			// `price` and `currentBidPrice` (same value). Replicate eBay's
			// wire shape so auction-aware callers don't have to special-
			// case scrape vs REST.
			if (inferredBuying === "AUCTION") item.currentBidPrice = money;
		}
		const watch = parseWatchCount(r.watchCountText);
		if (watch != null) item.watchCount = watch;
		const sellerInfo = parseSellerInfo(r.sellerFeedbackText);
		if (sellerInfo.username || sellerInfo.feedbackScore != null || sellerInfo.feedbackPercentage) {
			item.seller = {};
			if (sellerInfo.username) item.seller.username = sellerInfo.username;
			if (sellerInfo.feedbackPercentage) item.seller.feedbackPercentage = sellerInfo.feedbackPercentage;
			if (sellerInfo.feedbackScore != null) item.seller.feedbackScore = sellerInfo.feedbackScore;
		}
		const end = endDateFromTimeLeft(r.timeLeftText, now);
		if (end) item.itemEndDate = end;
		if (params.soldOnly) {
			const sold = parseSoldDate(r.soldDate);
			if (sold) item.lastSoldDate = sold.toISOString();
		}
		const soldQty = parseSoldQuantity(r.soldQuantityText);
		if (soldQty != null) item.totalSoldQuantity = soldQty;
		if (r.imageUrl) {
			item.image = { imageUrl: r.imageUrl };
			item.thumbnailImages = [{ imageUrl: r.imageUrl }];
		}

		out.push(item);
	}
	return out;
}

export interface EbayItemDetail {
	itemId: string | null;
	url: string;
	title: string;
	priceCents: number | null;
	currency: string;
	shippingCents: number | null;
	condition: string | null;
	/** Names of categories from the breadcrumb, leaf last. */
	categoryPath: string[];
	/** Numeric category IDs parallel to `categoryPath`. */
	categoryIds: string[];
	/** True when the page carries a Top Rated Plus badge. */
	topRatedBuyingExperience: boolean;
	seller: {
		name: string | null;
		feedbackScore: number | null;
		feedbackPercent: number | null;
	};
	bidCount: number | null;
	timeLeftText: string | null;
	watchCount: number | null;
	description: string | null;
	imageUrls: string[];
	/**
	 * Item-specifics rows from the detail page's "Item specifics" section.
	 * Mirror of Browse REST `localizedAspects: [{ name, value }]`.
	 */
	aspects: Array<{ name: string; value: string }>;
	itemCreationDate: string | null;
	itemEndDate: string | null;
	listingStatus: string | null;
	marketplaceListedOn: string | null;
	soldOut: boolean | null;
	itemLocationText: string | null;
}

function parseFeedbackPercent(text: string | null): number | null {
	if (!text) return null;
	const match = text.match(/([0-9]{1,3}(?:[.,][0-9]+)?)\s*%/);
	if (!match) return null;
	return Number.parseFloat((match[1] ?? "").replace(",", "."));
}

export function parseEbayDetailHtml(
	html: string,
	sourceUrl: string,
	domFactory: (html: string) => ParentNode,
): EbayItemDetail {
	const root = domFactory(html);
	const raw: RawEbayDetail = extractEbayDetail(root, sourceUrl, html);
	const price = parseEbayPrice(raw.priceText);
	return {
		itemId: raw.itemId,
		url: sourceUrl,
		title: raw.title,
		priceCents: price.cents,
		currency: price.currency,
		shippingCents: parseEbayShipping(raw.shippingText),
		condition: raw.conditionText,
		categoryPath: raw.categoryPath,
		categoryIds: raw.categoryIds,
		topRatedBuyingExperience: raw.topRatedBuyingExperience,
		seller: {
			name: raw.seller.name,
			feedbackScore: parseFeedbackScore(raw.seller.feedbackScoreText),
			feedbackPercent: parseFeedbackPercent(raw.seller.feedbackPercentText),
		},
		bidCount: parseBidCount(raw.bidCountText),
		timeLeftText: raw.timeLeftText,
		watchCount: parseWatchCount(raw.watchCountText),
		description: raw.description,
		imageUrls: raw.imageUrls,
		aspects: raw.aspects,
		itemCreationDate: raw.itemCreationDate,
		itemEndDate: raw.itemEndDate,
		listingStatus: raw.listingStatus,
		marketplaceListedOn: raw.marketplaceListedOn,
		soldOut: raw.soldOut,
		itemLocationText: raw.itemLocationText,
	};
}
