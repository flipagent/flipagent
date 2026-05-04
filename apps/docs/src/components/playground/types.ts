/**
 * Local types for the playground panels. Kept minimal — only the fields
 * the UI actually reads. The full server responses are still shown verbatim
 * in the trace JSON viewer, so we don't need exhaustive shape parity.
 *
 * Everything here mirrors `@flipagent/types` but without taking a dep on
 * it (docs is the closed marketing app; types is OSS).
 */

export type StepStatus = "pending" | "running" | "ok" | "error" | "skipped";

export interface Step {
	key: string;
	label: string;
	status: StepStatus;
	/**
	 * Logical parent for grouping. e.g. `search.sold` and `search.active`
	 * both have `parent: "search"`. The Trace UI renders children of the
	 * same parent side-by-side so parallel calls visibly run together.
	 * Synthetic parents (no underlying request — just a header) carry
	 * `parent: undefined` themselves.
	 */
	parent?: string;
	/** HTTP method + path the step calls. Surfaced in the trace so users see exactly what cURL would. */
	call?: { method: "GET" | "POST"; path: string };
	/** Request body for POST calls. JSON-rendered in the Request section of the trace. */
	requestBody?: unknown;
	/** HTTP response status code. Shown next to the call line. */
	httpStatus?: number;
	/** Parsed response body. Rendered in the Response section of the trace. */
	result?: unknown;
	/** Error summary when status === "error". */
	error?: string;
	durationMs?: number;
}

export interface Money {
	value: string;
	currency: string;
}

export interface Seller {
	username?: string;
	feedbackScore?: number;
	feedbackPercentage?: string;
}

export interface ShippingOption {
	shippingCost?: Money;
	shippingCostType?: string;
}

export interface ItemSummary {
	itemId: string;
	legacyItemId?: string;
	title: string;
	itemWebUrl: string;
	condition?: string;
	conditionId?: string;
	price?: Money;
	lastSoldPrice?: Money;
	/** AUCTION / FIXED_PRICE / BEST_OFFER. Drives the "Active bids" stat. */
	buyingOptions?: ReadonlyArray<"AUCTION" | "FIXED_PRICE" | "BEST_OFFER">;
	/** Current bid for live AUCTION listings — surfaced in Active bids row. */
	currentBidPrice?: Money;
	bidCount?: number;
	/** ISO 8601 — auction end time. Browse search returns it on summary
	 * for AUCTION listings, so the row can render a countdown without
	 * fetching detail. */
	itemEndDate?: string;
	image?: { imageUrl: string };
	/** Eyebrow trust signal — feedback %, score. Server-populated on detail; sometimes on summary too. */
	seller?: Seller;
	/** Shipping cost block. First entry is the primary domestic option; cents collapsed for the all-in line. */
	shippingOptions?: ReadonlyArray<ShippingOption>;
	/** True when eBay's third-party Authenticity Guarantee program covers
	 * this listing. Detail-only on Browse REST; the api's match enrich
	 * pass splices it onto every comp row before returning the pool, so
	 * the matches list can render an "AG" badge. */
	authenticityGuarantee?: boolean;
	/** Programs the listing qualifies for — `AUTHENTICITY_GUARANTEE`,
	 * `EBAY_REFURBISHED`, `EBAY_PLUS`, etc. Same source as `authenticityGuarantee`
	 * (matcher splice). Reserved for future per-program badges. */
	qualifiedPrograms?: ReadonlyArray<string>;
}

export interface LocalizedAspect {
	name: string;
	value: string;
	type?: string;
}

export interface ItemDetail extends ItemSummary {
	brand?: string;
	gtin?: string;
	categoryPath?: string;
	categoryId?: string;
	categoryIdPath?: string;
	description?: string;
	topRatedBuyingExperience?: boolean;
	authenticityGuarantee?: boolean;
	localizedAspects?: LocalizedAspect[];
	/** All listing images in seller-supplied order. First is primary. */
	images?: string[];
	/** ISO 8601 — auction end time. */
	endsAt?: string;
	/** Number of buyers watching the listing right now (when surfaced). */
	watchCount?: number;
	/** Where it ships from. */
	itemLocation?: { city?: string; region?: string; country?: string };
	/** Seller's return policy. */
	returnTerms?: { accepted?: boolean; periodDays?: number; shippingCostPayer?: "buyer" | "seller" };
	/** Original / strikethrough price for marked-down items. */
	originalPrice?: Money;
	/** "20" — percent off, eBay-shape kept verbatim. */
	discountPercentage?: string;
}

export interface AskStats {
	meanCents: number;
	stdDevCents: number;
	medianCents: number;
	p25Cents: number;
	p75Cents: number;
	nActive: number;
}

export interface MarketStats {
	keyword: string;
	marketplace: string;
	windowDays: number;
	meanCents: number;
	stdDevCents: number;
	medianCents: number;
	medianCiLowCents?: number;
	medianCiHighCents?: number;
	p25Cents: number;
	p75Cents: number;
	nObservations: number;
	salesPerDay: number;
	meanDaysToSell?: number;
	daysStdDev?: number;
	daysP50?: number;
	daysP70?: number;
	daysP90?: number;
	nDurations?: number;
	asks?: AskStats;
}

export interface ListPriceRecommendation {
	listPriceCents: number;
	expectedDaysToSell: number;
	sellProb7d: number;
	sellProb14d: number;
	sellProb30d: number;
	netCents: number;
	dollarsPerDay: number;
	annualizedRoi: number;
}

export interface MarketSummary {
	market: MarketStats;
	listPriceRecommendation: ListPriceRecommendation | null;
}

export interface RecoveryResponse {
	probability: number;
	minSellPriceCents: number;
	expectedDaysToSell?: number;
	nDurations: number;
	confidence: "high" | "medium" | "low" | "none";
	reason: string;
}

export interface Evaluation {
	rating?: string;
	expectedNetCents?: number;
	bidCeilingCents?: number;
	/** Cost components behind bidCeilingCents — surfaced under Safe bid. */
	safeBidBreakdown?: {
		estimatedSaleCents: number;
		feesCents: number;
		shippingCents: number;
		targetNetCents: number;
	} | null;
	confidence?: number;
	reason?: string;
	signals?: Array<{ name: string; reason: string }>;
	/**
	 * Single recommended exit plan: list at this price, expected to sell
	 * in this many days, with this much in your pocket after fees + ship +
	 * buy. Driven by hazard model + competition factor + active-mean blend.
	 */
	recommendedExit?: {
		listPriceCents: number;
		expectedDaysToSell: number;
		netCents: number;
		dollarsPerDay: number;
	} | null;
}

export interface BrowseSearchResponse {
	itemSummaries?: ItemSummary[];
	itemSales?: ItemSummary[];
	total?: number;
	/** Page offset / size the server actually applied. Drives the pager's "1–N of M" eyebrow. */
	offset?: number;
	limit?: number;
	/** Transport that produced this body — `"rest" | "scrape" | "bridge"`. */
	source?: string;
}

export type TransportSource = "rest" | "scrape" | "bridge";

export interface EvaluateMeta {
	itemSource: TransportSource;
	soldCount: number;
	soldSource: TransportSource | null;
	activeCount: number;
	activeSource: TransportSource | null;
	soldKept: number;
	soldRejected: number;
	activeKept: number;
	activeRejected: number;
}

/**
 * flipagent-derived returns summary, surfaced on the wrapper response so the
 * eBay-mirror `ItemDetail` stays a verbatim mirror. `null` when the chosen
 * transport didn't expose returns terms (e.g. some scrape paths).
 */
export interface Returns {
	accepted: boolean;
	periodDays?: number;
	shippingCostPaidBy?: "BUYER" | "SELLER";
}

export interface EvaluateResponse {
	item: ItemDetail;
	soldPool: ItemSummary[];
	activePool: ItemSummary[];
	rejectedSoldPool: ItemSummary[];
	rejectedActivePool: ItemSummary[];
	/** Per-itemId LLM reason string for rejected listings — keyed by
	 *  `ItemSummary.itemId` of items in `rejectedSoldPool` ∪
	 *  `rejectedActivePool`. Empty when LLM didn't run or nothing was
	 *  rejected. */
	rejectionReasons: Record<string, string>;
	market: MarketStats;
	evaluation: Evaluation;
	returns: Returns | null;
	meta: EvaluateMeta;
}

