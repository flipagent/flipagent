/**
 * Typed wrappers around the flipagent API for the playground panels.
 * Single source of truth for endpoint paths — pipelines and panels never
 * hand-build URLs. Cookie-auth: requireApiKey resolves the session into
 * the user's primary key, so plaintext never enters the browser.
 */

import { apiBase } from "../../lib/authClient";
import type {
	BrowseSearchResponse,
	ItemDetail,
	ItemSummary,
	MatchResponse,
	RankedDeal,
	RecoveryResponse,
	ThesisResponse,
	Verdict,
} from "./types";

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

export const playgroundApi = {
	listingsSearch: (params: { q?: string; filter?: string; sort?: string; limit?: number; category_ids?: string }) =>
		plan<BrowseSearchResponse>("GET", `/v1/listings/search${buildQuery(params)}`),

	soldSearch: (params: { q: string; filter?: string; limit?: number }) =>
		plan<BrowseSearchResponse>("GET", `/v1/sold/search${buildQuery(params)}`),

	itemDetail: (itemId: string) =>
		plan<ItemDetail>("GET", `/v1/listings/${encodeURIComponent(itemId)}`),

	match: (req: {
		candidate: ItemSummary;
		pool: ItemSummary[];
		options?: { useImages?: boolean };
	}) => plan<MatchResponse>("POST", "/v1/match", req),

	research: (req: { comps: ItemSummary[]; asks?: ItemSummary[] }) =>
		plan<ThesisResponse>("POST", "/v1/research/thesis", req),

	recovery: (req: {
		comps: ItemSummary[];
		costBasisCents: number;
		withinDays: number;
		minNetCents?: number;
	}) => plan<RecoveryResponse>("POST", "/v1/research/recovery_probability", req),

	evaluate: (req: {
		item: ItemSummary | ItemDetail;
		opts?: {
			comps?: ItemSummary[];
			asks?: ItemSummary[];
			minNetCents?: number;
			outboundShippingCents?: number;
			maxDaysToSell?: number;
		};
	}) => plan<Verdict>("POST", "/v1/evaluate", req),

	discover: (req: {
		results: BrowseSearchResponse;
		opts?: {
			comps?: ItemSummary[];
			minNetCents?: number;
			maxDaysToSell?: number;
			outboundShippingCents?: number;
		};
	}) => plan<{ deals: RankedDeal[] }>("POST", "/v1/discover", req),
};
