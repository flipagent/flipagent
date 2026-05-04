/**
 * Typed wrappers around the flipagent API for the playground panels.
 * Single source of truth for endpoint paths — pipelines and panels never
 * hand-build URLs. Cookie-auth: requireApiKey resolves the session into
 * the user's primary key, so plaintext never enters the browser.
 */

import { apiBase } from "../../lib/authClient";
import type { BrowseSearchResponse, EvaluateResponse, ItemDetail } from "./types";

export interface ApiResponse<T> {
	ok: boolean;
	status: number;
	body: T | { error?: string; message?: string };
	/** Method + path on `apiBase`. Surfaced in the trace UI. */
	call: { method: "GET" | "POST"; path: string };
	/** JSON request body for POST calls — surfaced in the trace's Request section. */
	requestBody?: unknown;
	durationMs: number;
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<ApiResponse<T>> {
	const start = performance.now();
	let res: Response;
	try {
		res = await fetch(`${apiBase}${path}`, {
			method,
			credentials: "include",
			headers: body !== undefined ? { "Content-Type": "application/json" } : {},
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});
	} catch (err) {
		// Network-level failure (server down, offline, CORS rejection). Normalise
		// into the same ApiResponse shape so the trace UI can surface it as an
		// error step instead of leaving the panel stuck on "Running".
		const message = err instanceof Error ? err.message : String(err);
		return {
			ok: false,
			status: 0,
			body: { error: "network_error", message } as { error?: string; message?: string },
			call: { method, path },
			requestBody: body,
			durationMs: Math.round(performance.now() - start),
		};
	}
	const text = await res.text();
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		parsed = text;
	}
	return {
		ok: res.ok,
		status: res.status,
		body: parsed as T,
		call: { method, path },
		requestBody: body,
		durationMs: Math.round(performance.now() - start),
	};
}

function buildQuery(params: Record<string, string | number | undefined>): string {
	const u = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.set(k, String(v));
	const s = u.toString();
	return s ? `?${s}` : "";
}

/**
 * Plan a request without dispatching. Lets the trace UI surface the URL
 * (and POST body) the moment a step starts, instead of waiting for the
 * response to land.
 */
export interface ApiPlan<T> {
	call: { method: "GET" | "POST"; path: string };
	requestBody?: unknown;
	exec: () => Promise<ApiResponse<T>>;
}

function plan<T>(method: "GET" | "POST", path: string, body?: unknown): ApiPlan<T> {
	return {
		call: { method, path },
		requestBody: body,
		exec: () => request<T>(method, path, body),
	};
}

/* ------------------------- /v1/items/search adapter ------------------------- */
/**
 * `/v1/items/search` is flipagent-native (cents-int Money, `items[]`,
 * structured query params). The playground panels read the eBay-shape
 * (`itemSummaries[]`, dollar-string Money, raw `filter=`). This
 * adapter translates between the two so PlaygroundSearch /
 * PlaygroundSourcing can stay on the eBay shape while calling the
 * native route.
 */

interface FlipagentMoney {
	value: number;
	currency: string;
}

interface FlipagentItem {
	id: string;
	title: string;
	url: string;
	price?: FlipagentMoney;
	soldPrice?: FlipagentMoney;
	condition?: string;
	conditionId?: string;
	buyingOptions?: ReadonlyArray<"auction" | "fixed_price" | "best_offer">;
	bidding?: { count: number; currentBid?: FlipagentMoney };
	images?: string[];
	seller?: { username: string; feedbackScore?: number; feedbackPercentage?: string };
	shipping?: { cost?: FlipagentMoney; free?: boolean };
	/* Detail-only fields — only populated by `/v1/items/{id}`, not search. */
	category?: { id: string; path?: string };
	aspects?: Record<string, string>;
	gtin?: string;
	mpn?: string;
	epid?: string;
	topRatedBuyingExperience?: boolean;
	authenticityGuarantee?: boolean;
	endsAt?: string;
	watchCount?: number;
	location?: { city?: string; region?: string; country?: string };
	returnTerms?: {
		accepted?: boolean;
		periodDays?: number;
		shippingCostPayer?: "buyer" | "seller";
	};
	marketingPrice?: {
		originalPrice?: FlipagentMoney;
		discountPercentage?: string;
		priceTreatment?: string;
	};
}

interface ItemSearchResponseBody {
	items?: FlipagentItem[];
	total?: number;
	offset?: number;
	limit?: number;
	source?: string;
}

function moneyCentsToDollarString(m: FlipagentMoney | undefined): { value: string; currency: string } | undefined {
	if (!m) return undefined;
	return { value: (m.value / 100).toFixed(2), currency: m.currency };
}

export type { FlipagentItem };
export function flipagentItemToSummary(item: FlipagentItem) {
	const itemId = item.id.startsWith("ebay:") ? item.id.slice(5) : item.id;
	const buyingOptions = item.buyingOptions?.map((b) =>
		b === "auction" ? ("AUCTION" as const) : b === "fixed_price" ? ("FIXED_PRICE" as const) : ("BEST_OFFER" as const),
	);
	const shippingOptions = item.shipping?.cost
		? [{ shippingCost: moneyCentsToDollarString(item.shipping.cost) }]
		: undefined;
	return {
		itemId,
		title: item.title,
		itemWebUrl: item.url,
		condition: item.condition,
		conditionId: item.conditionId,
		price: moneyCentsToDollarString(item.price),
		lastSoldPrice: moneyCentsToDollarString(item.soldPrice),
		buyingOptions,
		bidCount: item.bidding?.count,
		currentBidPrice: moneyCentsToDollarString(item.bidding?.currentBid),
		itemEndDate: item.endsAt,
		image: item.images?.[0] ? { imageUrl: item.images[0] } : undefined,
		seller: item.seller,
		shippingOptions,
	};
}

/**
 * Detail-shape adapter — extends the summary with the rich fields
 * `/v1/items/{id}` returns (aspects, category, gtin, top-rated, …).
 * Aspects are a flat key→value record on the wire; we expand to the
 * `LocalizedAspect[]` shape the playground UI consumes so the same
 * rendering code paths handle both wires.
 */
function flipagentItemToDetail(item: FlipagentItem): ItemDetail {
	const summary = flipagentItemToSummary(item);
	const aspects = item.aspects
		? Object.entries(item.aspects).map(([name, value]) => ({ name, value }))
		: undefined;
	const brand = item.aspects?.Brand ?? item.aspects?.brand;
	return {
		...summary,
		brand,
		gtin: item.gtin,
		categoryId: item.category?.id,
		categoryPath: item.category?.path,
		topRatedBuyingExperience: item.topRatedBuyingExperience,
		authenticityGuarantee: item.authenticityGuarantee,
		localizedAspects: aspects,
		images: item.images,
		endsAt: item.endsAt,
		watchCount: item.watchCount,
		itemLocation: item.location,
		returnTerms: item.returnTerms,
		originalPrice: moneyCentsToDollarString(item.marketingPrice?.originalPrice),
		discountPercentage: item.marketingPrice?.discountPercentage,
	};
}

function parseEbayFilterString(s: string | undefined): {
	conditionIds?: string[];
	priceMin?: number;
	priceMax?: number;
	buyingOption?: "auction" | "fixed_price" | "best_offer";
	/**
	 * Filter terms we don't translate to flipagent-native query fields —
	 * `itemLocationCountry`, `itemLocationRegion`, `returnsAccepted`,
	 * `maxDeliveryCost`, `topRatedListing`, `priceCurrency`, etc. They
	 * ride through the API's raw `filter` passthrough param.
	 */
	residualFilter?: string;
} {
	if (!s) return {};
	const out: {
		conditionIds?: string[];
		priceMin?: number;
		priceMax?: number;
		buyingOption?: "auction" | "fixed_price" | "best_offer";
		residualFilter?: string;
	} = {};
	// Top-level comma split. eBay's filter spec doesn't allow commas
	// inside `{...}` value lists, so a naive split is safe.
	const residual: string[] = [];
	for (const raw of s.split(",")) {
		const clause = raw.trim();
		if (!clause) continue;
		const cm = clause.match(/^conditionIds:\{([^}]+)\}$/);
		if (cm) {
			out.conditionIds = cm[1]
				.split("|")
				.map((x) => x.trim())
				.filter(Boolean);
			continue;
		}
		const pm = clause.match(/^price:\[([^\]]*)\]$/);
		if (pm) {
			const [lo, hi] = pm[1].split("..");
			if (lo) {
				const n = Number.parseFloat(lo);
				if (Number.isFinite(n)) out.priceMin = Math.round(n * 100);
			}
			if (hi) {
				const n = Number.parseFloat(hi);
				if (Number.isFinite(n)) out.priceMax = Math.round(n * 100);
			}
			continue;
		}
		const bm = clause.match(/^buyingOptions:\{([^}]+)\}$/);
		if (bm) {
			const v = bm[1].trim().toUpperCase();
			if (v === "AUCTION") out.buyingOption = "auction";
			else if (v === "FIXED_PRICE") out.buyingOption = "fixed_price";
			else if (v === "BEST_OFFER") out.buyingOption = "best_offer";
			continue;
		}
		// `priceCurrency:USD` is a hint paired with the price clause; if
		// price was already extracted the currency hint is redundant on
		// the flipagent side (everything's USD-cents internally).
		if (clause === "priceCurrency:USD") continue;
		residual.push(clause);
	}
	if (residual.length > 0) out.residualFilter = residual.join(",");
	return out;
}

const SORT_TO_FLIPAGENT: Record<string, string | undefined> = {
	"": undefined,
	newlyListed: "newest",
	endingSoonest: "ending_soonest",
	pricePlusShippingLowest: "price_asc",
};

function planSearchAdapter(params: {
	q?: string;
	mode?: "active" | "sold";
	filter?: string;
	sort?: string;
	limit?: number;
	offset?: number;
	category_ids?: string;
	gtin?: string;
}): ApiPlan<BrowseSearchResponse> {
	const mode = params.mode ?? "active";
	const parsed = parseEbayFilterString(params.filter);
	const sort = params.sort ? SORT_TO_FLIPAGENT[params.sort] : undefined;
	const qs = new URLSearchParams();
	if (params.q) qs.set("q", params.q);
	qs.set("status", mode);
	if (params.limit !== undefined) qs.set("limit", String(params.limit));
	if (params.offset !== undefined) qs.set("offset", String(params.offset));
	if (params.category_ids) qs.set("categoryId", params.category_ids);
	if (params.gtin) qs.set("gtin", params.gtin);
	if (sort) qs.set("sort", sort);
	if (parsed.priceMin !== undefined) qs.set("priceMin", String(parsed.priceMin));
	if (parsed.priceMax !== undefined) qs.set("priceMax", String(parsed.priceMax));
	if (parsed.buyingOption) qs.set("buyingOption", parsed.buyingOption);
	if (parsed.residualFilter) qs.set("filter", parsed.residualFilter);
	for (const c of parsed.conditionIds ?? []) qs.append("conditionIds", c);
	const path = `/v1/items/search?${qs.toString()}`;
	return {
		call: { method: "GET", path },
		exec: async () => {
			const raw = await request<ItemSearchResponseBody>("GET", path);
			if (!raw.ok || !raw.body || typeof raw.body !== "object") {
				return raw as unknown as ApiResponse<BrowseSearchResponse>;
			}
			const body = raw.body as ItemSearchResponseBody;
			const summaries = (body.items ?? []).map(flipagentItemToSummary);
			const adapted: BrowseSearchResponse = {
				...(mode === "sold"
					? { itemSales: summaries as BrowseSearchResponse["itemSales"] }
					: { itemSummaries: summaries as BrowseSearchResponse["itemSummaries"] }),
				total: body.total,
				offset: body.offset,
				limit: body.limit,
				source: body.source,
			};
			return { ...raw, body: adapted } as ApiResponse<BrowseSearchResponse>;
		},
	};
}

export const playgroundApi = {
	/**
	 * Unified search — `/v1/items/search` with a flipagent-native shape.
	 * The adapter (`planSearchAdapter`) keeps the panels' eBay-shape
	 * callers working unchanged.
	 */
	listingsSearch: (params: { q?: string; filter?: string; sort?: string; limit?: number; category_ids?: string }) =>
		planSearchAdapter({ ...params, mode: "active" }),

	soldSearch: (params: { q: string; filter?: string; limit?: number }) =>
		planSearchAdapter({ ...params, mode: "sold" }),

	search: (params: {
		q?: string;
		mode?: "active" | "sold";
		filter?: string;
		sort?: string;
		limit?: number;
		offset?: number;
		category_ids?: string;
		gtin?: string;
	}) => planSearchAdapter(params),

	itemDetail: (itemId: string): ApiPlan<ItemDetail> => {
		const path = `/v1/items/${encodeURIComponent(itemId)}`;
		return {
			call: { method: "GET", path },
			exec: async () => {
				const raw = await request<FlipagentItem>("GET", path);
				if (!raw.ok || !raw.body || typeof raw.body !== "object") {
					return raw as unknown as ApiResponse<ItemDetail>;
				}
				const adapted = flipagentItemToDetail(raw.body as FlipagentItem);
				return { ...raw, body: adapted } as ApiResponse<ItemDetail>;
			},
		};
	},

	evaluate: (req: {
		itemId: string;
		lookbackDays?: number;
		soldLimit?: number;
		opts?: {
			minNetCents?: number;
			outboundShippingCents?: number;
			maxDaysToSell?: number;
		};
	}) => plan<EvaluateResponse>("POST", "/v1/evaluate", req),

	/** Server-curated "Try one" examples sourced from real recent runs. */
	featuredEvaluations: (limit?: number) =>
		plan<{ items: Array<{ itemId: string; title: string; itemWebUrl: string; image?: string; completedAt: string }> }>(
			"GET",
			`/v1/evaluate/featured${limit ? `?limit=${limit}` : ""}`,
		),
};
