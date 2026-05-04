/**
 * Programmatic app-credential eBay REST client. Used by routes that
 * read public marketplace data (no user OAuth needed):
 *
 *   - commerce/taxonomy, commerce/catalog, commerce/translation,
 *     commerce/charity, commerce/media, commerce/identity (anonymous bits)
 *   - buy/browse search + detail, buy/marketplace_insights,
 *     buy/deal, buy/feed, buy/offer find_eligible_items
 *
 * Throws `EbayApiError` (shared with `user-client.ts`) on non-2xx so
 * the route boundary maps both client paths uniformly.
 */

import { isEbayAppConfigured } from "../../../config.js";
import { fetchRetry } from "../../../utils/fetch-retry.js";
import { ebayHostFor } from "../host.js";
import { getAppAccessToken } from "../oauth.js";
import { EbayApiError } from "./user-client.js";

const DEFAULT_MARKETPLACE_ID = "EBAY_US";

export interface AppRequestOpts {
	method?: "GET" | "POST";
	path: string;
	body?: unknown;
	marketplace?: string;
	acceptLanguage?: string;
}

export async function appRequest<T = unknown>(opts: AppRequestOpts): Promise<T> {
	if (!isEbayAppConfigured()) {
		throw new EbayApiError(503, "ebay_not_configured", "eBay app credentials (EBAY_CLIENT_ID/SECRET) are not set.");
	}
	let token: string;
	try {
		token = await getAppAccessToken();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new EbayApiError(502, "ebay_app_token_failed", `eBay app token request failed: ${msg}`);
	}

	const headers: Record<string, string> = {
		Authorization: `Bearer ${token}`,
		Accept: "application/json",
		"X-EBAY-C-MARKETPLACE-ID": opts.marketplace ?? DEFAULT_MARKETPLACE_ID,
	};
	if (opts.acceptLanguage) headers["Accept-Language"] = opts.acceptLanguage;
	if (opts.body !== undefined) headers["Content-Type"] = "application/json";

	const url = `${ebayHostFor(opts.path)}${opts.path}`;
	const res = await fetchRetry(url, {
		method: opts.method ?? "GET",
		headers,
		body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
	});

	if (res.status === 204) return undefined as T;

	const text = await res.text();
	const parsed = text ? safeJson(text) : undefined;
	if (!res.ok) {
		const message = extractEbayMessage(parsed) ?? `eBay returned ${res.status}`;
		throw new EbayApiError(res.status, `ebay_${res.status}`, message, parsed ?? text);
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
	errors?: Array<{ message?: string; longMessage?: string }>;
}

function extractEbayMessage(parsed: unknown): string | undefined {
	if (!parsed || typeof parsed !== "object") return undefined;
	const env = parsed as EbayErrorEnvelope;
	if (!env.errors?.length) return undefined;
	const first = env.errors[0]!;
	return first.longMessage ?? first.message;
}
