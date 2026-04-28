/**
 * eBay-shaped error envelope helpers. eBay's REST APIs return errors as:
 *
 * ```json
 * { "errors": [{ "errorId": 1001, "domain": "API_AUTH", "category": "REQUEST",
 *                "message": "...", "longMessage": "..." }] }
 * ```
 *
 * For eBay-compat paths (`/buy/*`, `/sell/*`, `/commerce/*`) flipagent's
 * own errors (not_configured / not_connected / not_implemented) match this
 * shape so eBay SDKs can route errors through their existing handlers.
 *
 * flipagent-defined errorIds live in 50000+ to avoid colliding with eBay's
 * documented error namespace. The `domain` is `FLIPAGENT` so a caller can
 * filter our errors out from upstream eBay errors if they want.
 */

import type { ContentfulStatusCode } from "hono/utils/http-status";

export type EbayErrorCategory = "REQUEST" | "APPLICATION" | "BUSINESS";

export interface EbayErrorDetail {
	errorId: number;
	domain: string;
	category: EbayErrorCategory;
	message: string;
	longMessage?: string;
	subdomain?: string;
}

export interface EbayErrorEnvelope {
	errors: EbayErrorDetail[];
}

export function ebayError(detail: EbayErrorDetail): EbayErrorEnvelope {
	return { errors: [detail] };
}

/** flipagent error catalog — keep stable; downstream SDKs will switch on these. */
export const FLIPAGENT_ERRORS = {
	notConfigured: (msg = "EBAY_CLIENT_ID/SECRET/RU_NAME unset on this api instance."): EbayErrorDetail => ({
		errorId: 50001,
		domain: "FLIPAGENT",
		category: "APPLICATION",
		message: "service_not_configured",
		longMessage: msg,
	}),
	notConnected: (msg = "Connect this api key to an eBay account at GET /v1/connect/ebay first."): EbayErrorDetail => ({
		errorId: 50002,
		domain: "FLIPAGENT",
		category: "REQUEST",
		message: "ebay_account_not_connected",
		longMessage: msg,
	}),
	tokenRefreshFailed: (msg: string): EbayErrorDetail => ({
		errorId: 50003,
		domain: "FLIPAGENT",
		category: "APPLICATION",
		message: "token_refresh_failed",
		longMessage: msg,
	}),
	upstreamFailed: (msg: string): EbayErrorDetail => ({
		errorId: 50004,
		domain: "FLIPAGENT",
		category: "APPLICATION",
		message: "upstream_request_failed",
		longMessage: msg,
	}),
	notImplemented: (msg: string): EbayErrorDetail => ({
		errorId: 50101,
		domain: "FLIPAGENT",
		category: "APPLICATION",
		message: "not_implemented",
		longMessage: msg,
	}),
	orderApiPending: (): EbayErrorDetail => ({
		errorId: 50102,
		domain: "FLIPAGENT",
		category: "APPLICATION",
		message: "order_api_approval_pending",
		longMessage:
			"eBay Order API is Limited Release. Will activate once flipagent's tenant approval lands; set EBAY_ORDER_API_APPROVED=1.",
	}),
	appTokenFailed: (msg: string): EbayErrorDetail => ({
		errorId: 50005,
		domain: "FLIPAGENT",
		category: "APPLICATION",
		message: "app_token_failed",
		longMessage: msg,
	}),
} as const;

export type FlipagentErrorKey = keyof typeof FLIPAGENT_ERRORS;

/** Convenience for Hono handlers — returns a Response with eBay envelope + status. */
export function ebayErrorJson<S extends ContentfulStatusCode>(
	c: { json: (body: unknown, status: S) => Response },
	detail: EbayErrorDetail,
	status: S,
): Response {
	return c.json(ebayError(detail), status);
}
