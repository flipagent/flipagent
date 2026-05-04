/**
 * Single error class for the listings service layer. Routes catch this
 * once at the top of each handler and translate code → HTTP status +
 * forward `body` verbatim (so eBay's REST error envelopes pass through
 * untouched, and bridge / scrape errors carry their structured codes).
 */

import type { EbayVariation } from "@flipagent/ebay-scraper";

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

/**
 * Thrown when a caller asks for detail on a multi-SKU parent listing
 * (sneakers / clothes / bags) without specifying which variation. Today
 * only the REST transport raises this — eBay's `get_item_by_legacy_id`
 * returns errorId 11006 with an `itemGroupHref` pointer; we follow that
 * pointer to enumerate the variations and surface them on this error so
 * the caller can pick one and retry. Scrape / bridge currently return
 * the page-default-rendered variation silently; the evaluate pipeline
 * raises this same error type at a higher layer for those transports
 * to converge the wire shape.
 */
export class MultiVariationParentError extends Error {
	constructor(
		readonly legacyId: string,
		readonly variations: ReadonlyArray<EbayVariation>,
	) {
		super(
			`Listing ${legacyId} is a multi-SKU parent with ${variations.length} variations; pass a specific variationId.`,
		);
		this.name = "MultiVariationParentError";
	}
}
