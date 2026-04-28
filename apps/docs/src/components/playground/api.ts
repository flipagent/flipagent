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
	ThesisResponse,
	Verdict,
} from "./types";

export interface ApiResponse<T> {
	ok: boolean;
	status: number;
	body: T | { error?: string; message?: string };
	/** Method + path on `apiBase`. Surfaced in the trace UI. */
	call: { method: "GET" | "POST"; path: string };
	durationMs: number;
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<ApiResponse<T>> {
	const start = performance.now();
	const res = await fetch(`${apiBase}${path}`, {
		method,
		credentials: "include",
		headers: body !== undefined ? { "Content-Type": "application/json" } : {},
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
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
		durationMs: Math.round(performance.now() - start),
	};
}

function buildQuery(params: Record<string, string | number | undefined>): string {
	const u = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.set(k, String(v));
	const s = u.toString();
	return s ? `?${s}` : "";
}

export const playgroundApi = {
	listingsSearch: (params: { q?: string; filter?: string; sort?: string; limit?: number; category_ids?: string }) =>
		request<BrowseSearchResponse>("GET", `/v1/listings/search${buildQuery(params)}`),

	soldSearch: (params: { q: string; filter?: string; limit?: number }) =>
		request<BrowseSearchResponse>("GET", `/v1/sold/search${buildQuery(params)}`),

	itemDetail: (itemId: string) =>
		request<ItemDetail>("GET", `/v1/listings/${encodeURIComponent(itemId)}`),

	match: (req: { candidate: ItemSummary; pool: ItemSummary[]; options?: Record<string, number> }) =>
		request<MatchResponse>("POST", "/v1/match", req),

	research: (req: { comps: ItemSummary[]; asks?: ItemSummary[] }) =>
		request<ThesisResponse>("POST", "/v1/research/thesis", req),

	evaluate: (req: { item: ItemSummary | ItemDetail; opts?: { comps?: ItemSummary[] } }) =>
		request<Verdict>("POST", "/v1/evaluate", req),

	discover: (req: { results: BrowseSearchResponse; opts?: { comps?: ItemSummary[] } }) =>
		request<{ deals: RankedDeal[] }>("POST", "/v1/discover", req),
};
