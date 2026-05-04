/**
 * Programmatic user-OAuth eBay REST client. Every `/v1/*` route that
 * needs the connected seller's eBay account funnels through here:
 *
 *   - sell/inventory, sell/fulfillment, sell/finances, sell/account,
 *     sell/marketing, sell/negotiation, sell/analytics, sell/compliance,
 *     sell/recommendation, sell/logistics, sell/stores, sell/feed,
 *     sell/metadata
 *   - buy/order, buy/offer
 *   - post-order/v2/*
 *   - commerce/notification (subscription CRUD)
 *
 * `EbayApiError` carries `status`, `code`, `message` plus the upstream
 * envelope. Route handlers map to flipagent error shapes at the
 * boundary; everything else just rethrows.
 */

import { isEbayOAuthConfigured } from "../../../config.js";
import type { NextActionKind } from "../../../services/shared/next-action.js";
import { fetchRetry } from "../../../utils/fetch-retry.js";
import { ebayHostFor } from "../host.js";
import { getUserAccessToken } from "../oauth.js";

export class EbayApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly upstream: unknown;
	/**
	 * When set, the global onError handler attaches a fully-resolved
	 * `next_action` block to the response body — pointing the caller at
	 * the OAuth start URL, the extension install page, etc. See
	 * `services/shared/next-action.ts`.
	 */
	readonly nextActionKind: NextActionKind | undefined;
	constructor(status: number, code: string, message: string, upstream?: unknown, nextActionKind?: NextActionKind) {
		super(message);
		this.name = "EbayApiError";
		this.status = status;
		this.code = code;
		this.upstream = upstream;
		this.nextActionKind = nextActionKind;
	}
}

export interface SellRequestOpts {
	apiKeyId: string;
	method: "GET" | "POST" | "PUT" | "DELETE";
	path: string;
	body?: unknown;
	marketplace?: string;
	contentLanguage?: string;
}

/**
 * eBay REST call with the api-key's user OAuth token. Throws
 * `EbayApiError` with `status` + `code` on non-2xx (callers map to the
 * appropriate flipagent error shape at the route boundary).
 */
export async function sellRequest<T = unknown>(opts: SellRequestOpts): Promise<T> {
	if (!isEbayOAuthConfigured()) {
		throw new EbayApiError(
			503,
			"ebay_not_configured",
			"eBay OAuth credentials are not set on this api instance.",
			undefined,
			"configure_ebay",
		);
	}
	let token: string;
	try {
		token = await getUserAccessToken(opts.apiKeyId);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg === "not_connected") {
			throw new EbayApiError(
				401,
				"ebay_account_not_connected",
				"Connect an eBay seller account first.",
				undefined,
				"ebay_oauth",
			);
		}
		throw new EbayApiError(502, "ebay_token_refresh_failed", `eBay token refresh failed: ${msg}`);
	}

	// Post-Order v2 (`/post-order/v2/...`) is the legacy IAF-token pipe;
	// every other surface is RESTful Bearer. Live-verified 2026-05-02:
	// `Authorization: Bearer …` returns 401 on post-order paths;
	// `Authorization: IAF …` returns the real payload. Without this
	// branch the existing `/v1/disputes` LIST + GET routes silently
	// resolved to empty for return / case / cancellation / inquiry types
	// (their `.catch(() => null)` swallowed the auth failure).
	const isPostOrder = opts.path.startsWith("/post-order/");
	const headers: Record<string, string> = {
		Authorization: isPostOrder ? `IAF ${token}` : `Bearer ${token}`,
		Accept: "application/json",
		"Accept-Language": "en-US",
	};
	if (opts.body !== undefined) headers["Content-Type"] = "application/json";
	if (opts.marketplace) headers["X-EBAY-C-MARKETPLACE-ID"] = opts.marketplace;
	if (opts.contentLanguage) headers["Content-Language"] = opts.contentLanguage;

	const url = `${ebayHostFor(opts.path)}${opts.path}`;
	const res = await fetchRetry(url, {
		method: opts.method,
		headers,
		body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
	});

	if (res.status === 204) return undefined as T;

	const text = await res.text();
	const parsed = text ? safeJson(text) : undefined;
	if (!res.ok) {
		const message = extractEbayMessage(parsed) ?? `eBay returned ${res.status}`;
		const code = `ebay_${res.status}`;
		throw new EbayApiError(res.status, code, message, parsed ?? text);
	}
	return (parsed as T) ?? (undefined as T);
}

/**
 * Variant of `sellRequest` that also returns the new resource id eBay
 * stamps into the `Location` response header on POST creates. Many
 * Sell APIs return `201 Created` with an EMPTY body — the only place
 * the new id appears is `Location: http://api.ebay.com/sell/{id}` (or
 * similar URL with the id as last path segment).
 *
 * Verified live 2026-05-03 against `POST /sell/account/v1/custom_policy`:
 * status 201, no body, `Location: http://api.ebay.com/sell/460147982337`.
 * Wrappers reading `customPolicyId` from the body got undefined every
 * time. Same pattern applies to: `POST /{fulfillment,payment,return}_policy`,
 * `POST /item_promotion`, `POST /item_price_markdown`, `POST /ad_campaign`,
 * `POST /ad_campaign/{cid}/ad`, `POST /ad_campaign/{cid}/ad_group`.
 *
 * Returns `null` `locationId` when the Location header is missing or
 * doesn't have a parseable last-segment id (e.g. eBay returns id in
 * the body for that specific endpoint — fall back to `body.<idField>`).
 */
export async function sellRequestWithLocation<T = unknown>(
	opts: SellRequestOpts,
): Promise<{ body: T | undefined; locationId: string | null }> {
	if (!isEbayOAuthConfigured()) {
		throw new EbayApiError(
			503,
			"ebay_not_configured",
			"eBay OAuth credentials are not set on this api instance.",
			undefined,
			"configure_ebay",
		);
	}
	let token: string;
	try {
		token = await getUserAccessToken(opts.apiKeyId);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg === "not_connected") {
			throw new EbayApiError(
				401,
				"ebay_account_not_connected",
				"Connect an eBay seller account first.",
				undefined,
				"ebay_oauth",
			);
		}
		throw new EbayApiError(502, "ebay_token_refresh_failed", `eBay token refresh failed: ${msg}`);
	}
	const isPostOrder = opts.path.startsWith("/post-order/");
	const headers: Record<string, string> = {
		Authorization: isPostOrder ? `IAF ${token}` : `Bearer ${token}`,
		Accept: "application/json",
		"Accept-Language": "en-US",
	};
	if (opts.body !== undefined) headers["Content-Type"] = "application/json";
	if (opts.marketplace) headers["X-EBAY-C-MARKETPLACE-ID"] = opts.marketplace;
	if (opts.contentLanguage) headers["Content-Language"] = opts.contentLanguage;
	const url = `${ebayHostFor(opts.path)}${opts.path}`;
	const res = await fetchRetry(url, {
		method: opts.method,
		headers,
		body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
	});
	const text = res.status === 204 ? "" : await res.text();
	const parsed = text ? safeJson(text) : undefined;
	if (!res.ok) {
		const message = extractEbayMessage(parsed) ?? `eBay returned ${res.status}`;
		throw new EbayApiError(res.status, `ebay_${res.status}`, message, parsed ?? text);
	}
	const location = res.headers.get("location") ?? res.headers.get("Location");
	const locationId = location ? (location.split(/[/?#]/).filter(Boolean).pop() ?? null) : null;
	return { body: parsed as T | undefined, locationId };
}

/**
 * `.catch()` handler that converts an EbayApiError 404 into `null`
 * and re-throws everything else. Use this in place of the bare
 * `.catch(() => null)` anti-pattern, which silently swallows scope
 * errors, outages, network issues, and auth bugs (see the post-order
 * IAF mismatch in commit 5f4b83c and the missing-sell.marketing-scope
 * silent failure in commit e120fa4 — both were hidden for months by
 * `.catch(() => null)`).
 *
 * Two forms for ergonomic use:
 *   - `swallow404(sellRequest(...))` — wrap the whole promise
 *   - `sellRequest(...).catch(swallowEbay404)` — chained at the end
 */
export async function swallow404<T>(promise: Promise<T>): Promise<T | null> {
	try {
		return await promise;
	} catch (err) {
		if (err instanceof EbayApiError && err.status === 404) return null;
		throw err;
	}
}

export function swallowEbay404(err: unknown): null {
	if (err instanceof EbayApiError && err.status === 404) return null;
	throw err;
}

function safeJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

interface EbayErrorEnvelope {
	errors?: Array<{ message?: string; longMessage?: string; errorId?: number; parameters?: unknown }>;
}

function extractEbayMessage(parsed: unknown): string | undefined {
	if (!parsed || typeof parsed !== "object") return undefined;
	const env = parsed as EbayErrorEnvelope;
	if (!env.errors?.length) return undefined;
	const first = env.errors[0]!;
	return first.longMessage ?? first.message;
}
