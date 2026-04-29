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
	image?: { imageUrl: string };
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
	localizedAspects?: LocalizedAspect[];
}

export interface MatchedItem {
	item: ItemSummary;
	bucket: "match" | "reject";
	reason: string;
}

export interface MatchResponse {
	match: MatchedItem[];
	reject: MatchedItem[];
	totals: { match: number; reject: number };
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
	winProbability?: number;
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

export interface RankedDeal {
	itemId: string;
	evaluation: Evaluation;
}

export interface BrowseSearchResponse {
	itemSummaries?: ItemSummary[];
	itemSales?: ItemSummary[];
	total?: number;
}

