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

import { config, isEbayOAuthConfigured } from "../../../config.js";
import type { NextActionKind } from "../../../services/shared/next-action.js";
import { fetchRetry } from "../../../utils/fetch-retry.js";
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

	const url = `${config.EBAY_BASE_URL}${opts.path}`;
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
