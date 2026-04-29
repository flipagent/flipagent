/**
 * Canonical bridge task names. The Chrome extension claims these via
 * `GET /v1/bridge/poll` and dispatches based on `task` field. Using
 * named constants (instead of inline strings spread across services)
 * keeps task names aligned with the `/v1/*` resource surface they
 * serve so the extension's recipe runtime can map task → DOM recipe
 * by URL pattern alone.
 *
 * Naming convention: `<provider>_<resource>_<action>` — provider
 * lowercase, resource lowercase singular, action present-tense verb.
 * Existing names that don't fit (`pull_packages`, `reload_extension`,
 * `browser_op`, `ebay_query`) are preserved for back-compat with
 * pre-rename extension builds; new tasks use the new convention.
 */

export const BRIDGE_TASKS = {
	// eBay buy-side
	EBAY_BUY_ITEM: "ebay_buy_item",
	EBAY_QUERY: "ebay_query",
	// eBay logged-in inboxes (bridge-only, no API equivalent)
	EBAY_INBOX_WATCHING: "ebay_inbox_watching",
	EBAY_INBOX_OFFERS: "ebay_inbox_offers",
	EBAY_INBOX_CASES: "ebay_inbox_cases",
	EBAY_INBOX_SAVED_SEARCHES: "ebay_inbox_saved_searches",
	// Forwarder
	PLANETEXPRESS_PULL_PACKAGES: "pull_packages",
	// Generic primitives
	BROWSER_OP: "browser_op",
	RELOAD_EXTENSION: "reload_extension",
} as const;

export type BridgeTask = (typeof BRIDGE_TASKS)[keyof typeof BRIDGE_TASKS];

/**
 * Map the order's `source` column (set when the order is queued) to
 * the canonical bridge task name. The bridge route uses this when
 * handing a claimed job to the extension; keeping one map prevents
 * the inline `if (source === "planetexpress") ... else ...` chain
 * from sprawling as new task types are added.
 */
export function bridgeTaskForSource(source: string): BridgeTask {
	switch (source) {
		case "planetexpress":
			return BRIDGE_TASKS.PLANETEXPRESS_PULL_PACKAGES;
		case "control":
			return BRIDGE_TASKS.RELOAD_EXTENSION;
		case "browser":
			return BRIDGE_TASKS.BROWSER_OP;
		case "ebay_data":
			return BRIDGE_TASKS.EBAY_QUERY;
		// "ebay" (default): buy-side checkout
		default:
			return BRIDGE_TASKS.EBAY_BUY_ITEM;
	}
}
