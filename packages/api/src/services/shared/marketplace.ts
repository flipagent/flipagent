/**
 * Translation between flipagent's `Marketplace` literal (provider+region
 * combined, e.g. `ebay_us`) and provider-native ids the upstream APIs
 * actually accept.
 *
 * The flipagent surface is provider-agnostic; this is the only place
 * that knows how each provider names its regions internally. Everywhere
 * else takes the flipagent literal.
 */

import type { Marketplace } from "@flipagent/types";

const FLIPAGENT_TO_EBAY: Record<Marketplace, string> = {
	ebay_us: "EBAY_US",
};

/**
 * Translate a flipagent `Marketplace` literal to the eBay marketplace_id
 * eBay's REST APIs (`X-EBAY-C-MARKETPLACE-ID`, `?marketplace_id=…`)
 * expect.
 *
 * Missing/`undefined` resolves to the default (`EBAY_US`) so route
 * handlers can pass through whatever was on the validated input without
 * an extra branch — the only currently-valid literal also maps to the
 * default.
 */
export function ebayMarketplaceId(marketplace?: Marketplace): string {
	return marketplace ? FLIPAGENT_TO_EBAY[marketplace] : "EBAY_US";
}
