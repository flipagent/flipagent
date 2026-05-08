/**
 * Typed wrappers around the flipagent API for the playground panels.
 * Single source of truth for endpoint paths — pipelines and panels never
 * hand-build URLs. Cookie-auth: requireApiKey resolves the session into
 * the user's primary key, so plaintext never enters the browser.
 */

import { apiBase } from "../../lib/authClient";
import type { WireSearchParams } from "./SearchFilters";
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
	/* Trust + signal fields — present on both summary (search) and detail
	 * (`/v1/items/{id}`). REST Browse + the api's items/transform both
	 * emit them on summary too. */
	topRatedBuyingExperience?: boolean;
	authenticityGuarantee?: boolean;
	watchCount?: number;
	location?: { city?: string; region?: string; country?: string };
	endsAt?: string;
	/* Detail-only fields — only populated by `/v1/items/{id}`, not search. */
	category?: { id: string; path?: string };
	aspects?: Record<string, string>;
	gtin?: string;
	mpn?: string;
	epid?: string;
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
		topRatedBuyingExperience: item.topRatedBuyingExperience,
		authenticityGuarantee: item.authenticityGuarantee,
		watchCount: item.watchCount,
		itemLocation: item.location,
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
		localizedAspects: aspects,
		images: item.images,
		endsAt: item.endsAt,
		returnTerms: item.returnTerms,
		originalPrice: moneyCentsToDollarString(item.marketingPrice?.originalPrice),
		discountPercentage: item.marketingPrice?.discountPercentage,
	};
}

/**
 * `/v1/items/search` adapter. Takes the validated wire shape
 * (`WireSearchParams` from `SearchFilters.tsx` — produced by
 * `searchQueryToWire`) and serialises it into URL params. No
 * intermediate "playground call params" layer; what the panel built is
 * what gets sent.
 */
function planSearchAdapter(wire: WireSearchParams): ApiPlan<BrowseSearchResponse> {
	const qs = new URLSearchParams();
	qs.set("status", wire.status);
	qs.set("limit", String(wire.limit));
	if (wire.q) qs.set("q", wire.q);
	if (wire.offset && wire.offset > 0) qs.set("offset", String(wire.offset));
	if (wire.categoryId) qs.set("categoryId", wire.categoryId);
	if (wire.gtin) qs.set("gtin", wire.gtin);
	for (const c of wire.conditionIds ?? []) qs.append("conditionIds", c);
	if (wire.priceMin !== undefined) qs.set("priceMin", String(wire.priceMin));
	if (wire.priceMax !== undefined) qs.set("priceMax", String(wire.priceMax));
	if (wire.buyingOption) qs.set("buyingOption", wire.buyingOption);
	if (wire.sort) qs.set("sort", wire.sort);
	if (wire.filter) qs.set("filter", wire.filter);
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
				...(wire.status === "sold"
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
	/** `/v1/items/search` — pass the wire shape from `searchQueryToWire(query)`. */
	search: (wire: WireSearchParams) => planSearchAdapter(wire),

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
		ref:
			| { kind: "id"; productId: string; variantId?: string }
			| { kind: "external"; marketplace: string; listingId: string }
			| {
					kind: "query";
					q: string;
					hints?: { size?: string; color?: string; condition?: string; marketplace?: string };
			  };
		lookbackDays?: number;
		soldLimit?: number;
		opts?: {
			minNetCents?: number;
			outboundShippingCents?: number;
		};
	}) => plan<EvaluateResponse>("POST", "/v1/evaluate", req),

	/** Drill-down companion to `evaluate` — kept + rejected pools with
	 *  per-item rejection reasons. Used by the inline agent EvaluatePanel
	 *  to lazy-load rejected comps without paying for them in the LLM
	 *  context (the agent digest already carries kept pools eagerly). */
	evaluatePool: (itemId: string) =>
		plan<{
			itemId: string;
			evaluatedAt: string;
			sold: { kept: unknown[]; rejected: unknown[] };
			active: { kept: unknown[]; rejected: unknown[] };
		}>("GET", `/v1/evaluate/${encodeURIComponent(itemId)}/pool`),

	/** Server-curated "Try one" examples sourced from real recent runs. */
	featuredEvaluations: (limit?: number) =>
		plan<{ items: Array<{ itemId: string; title: string; itemWebUrl: string; image?: string; completedAt: string }> }>(
			"GET",
			`/v1/evaluate/featured${limit ? `?limit=${limit}` : ""}`,
		),

};
