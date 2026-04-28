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
	/** Parsed response body. Rendered as JSON in the trace. */
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
	score: number;
	bucket: "match" | "borderline" | "reject";
	reason: string;
}

export interface MatchResponse {
	match: MatchedItem[];
	borderline: MatchedItem[];
	reject: MatchedItem[];
	totals: { match: number; borderline: number; reject: number };
}

export interface MarketStats {
	keyword: string;
	marketplace: string;
	windowDays: number;
	meanCents: number;
	stdDevCents: number;
	medianCents: number;
	p25Cents: number;
	p75Cents: number;
	nObservations: number;
	salesPerDay: number;
	meanDaysToSell?: number;
	daysStdDev?: number;
}

export interface ListPriceAdvice {
	listPriceCents: number;
	expectedDaysToSell: number;
	sellProb7d: number;
	sellProb14d: number;
	netCents: number;
	dollarsPerDay: number;
	annualizedRoi: number;
}

export interface ThesisResponse {
	market: MarketStats;
	listPriceAdvice: ListPriceAdvice | null;
}

export interface Verdict {
	rating?: string;
	isDeal?: boolean;
	netCents?: number;
	bidCeilingCents?: number;
	probProfit?: number;
	confidence?: number;
	reason?: string;
	signals?: Array<{ name: string; reason: string }>;
}

export interface RankedDeal {
	itemId: string;
	verdict: Verdict;
}

export interface BrowseSearchResponse {
	itemSummaries?: ItemSummary[];
	itemSales?: ItemSummary[];
	total?: number;
}

