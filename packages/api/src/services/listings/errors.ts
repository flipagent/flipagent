/**
 * Single error class for the listings service layer. Routes catch this
 * once at the top of each handler and translate code → HTTP status +
 * forward `body` verbatim (so eBay's REST error envelopes pass through
 * untouched, and bridge / scrape errors carry their structured codes).
 */

export type ListingsErrorCode =
	| "not_configured"
	| "ebay_not_configured"
	| "insights_not_approved"
	| "invalid_item_id"
	| "not_found"
	| "upstream_failed"
	| "bridge_not_paired"
	| "bridge_timeout"
	| "bridge_failed";

export class ListingsError extends Error {
	constructor(
		readonly code: ListingsErrorCode,
		readonly status: number,
		message: string,
		/**
		 * Optional response body to forward. When set, routes return this
		 * verbatim — used to relay eBay's parsed error envelope. When
		 * omitted, routes synthesize `{error: code, message}`.
		 */
		readonly body?: unknown,
	) {
		super(message);
		this.name = "ListingsError";
	}
}
