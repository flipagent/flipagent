/**
 * Computes the capability map served by `GET /v1/capabilities`. Pulls
 * together: bridge-token presence, eBay seller OAuth row, env-driven
 * eBay tenant approvals, and scrape-proxy availability.
 *
 * As we add Amazon / Mercari, each gets its own block here. The shape
 * of `MarketplaceCapabilities` per marketplace is identical so the
 * agent's tool-selection logic stays uniform.
 */

import type {
	CapabilitiesResponse,
	CapabilityStatus,
	ForwarderCapabilities,
	MarketplaceCapabilities,
} from "@flipagent/types";
import { and, desc, eq, isNull } from "drizzle-orm";
import { config, isEbayOAuthConfigured, isInsightsApproved, isScraperApiConfigured } from "../../config.js";
import { db } from "../../db/client.js";
import { bridgeTokens, userEbayOauth } from "../../db/schema.js";

export async function computeCapabilities(apiKeyId: string): Promise<CapabilitiesResponse> {
	const [bridgeRows, oauthRows] = await Promise.all([
		db
			.select({
				deviceName: bridgeTokens.deviceName,
				lastSeenAt: bridgeTokens.lastSeenAt,
				ebayLoggedIn: bridgeTokens.ebayLoggedIn,
			})
			.from(bridgeTokens)
			.where(and(eq(bridgeTokens.apiKeyId, apiKeyId), isNull(bridgeTokens.revokedAt)))
			.orderBy(desc(bridgeTokens.createdAt))
			.limit(1),
		db.select({ id: userEbayOauth.id }).from(userEbayOauth).where(eq(userEbayOauth.apiKeyId, apiKeyId)).limit(1),
	]);

	const bridge = bridgeRows[0];
	const sellerConnected = oauthRows.length > 0;

	const ebay = ebayCapabilities({
		extensionPaired: !!bridge,
		ebayLoggedIn: !!bridge?.ebayLoggedIn,
		sellerConnected,
	});
	const planetexpress = planetExpressCapabilities({ extensionPaired: !!bridge });

	return {
		client: {
			extensionPaired: !!bridge,
			deviceName: bridge?.deviceName ?? null,
			lastSeenAt: bridge?.lastSeenAt ? bridge.lastSeenAt.toISOString() : null,
		},
		marketplaces: { ebay },
		forwarders: { planetexpress },
		generatedAt: new Date().toISOString(),
	};
}

interface EbayInputs {
	extensionPaired: boolean;
	ebayLoggedIn: boolean;
	sellerConnected: boolean;
}

function ebayCapabilities(input: EbayInputs): MarketplaceCapabilities {
	// Search / detail / sold are picked per-route by env: `rest` (Browse
	// REST, requires `EBAY_CLIENT_ID`), `scrape` (managed scraping vendor,
	// requires `SCRAPER_API_USERNAME/PASSWORD`), or `bridge` (extension,
	// requires the caller's extension to be paired). Capability surface
	// reports `ok` when *any* primitive is available; the actual route
	// picks one based on its own env.
	const anySource = isEbayOAuthConfigured() || isScraperApiConfigured() || input.extensionPaired;
	const search: CapabilityStatus = anySource ? "ok" : "unavailable";
	const detail: CapabilityStatus = search;
	const sold: CapabilityStatus =
		isInsightsApproved() || isScraperApiConfigured() || input.extensionPaired ? "ok" : "unavailable";

	// Evaluate: pure server-side scoring; works whenever the api can
	// fetch sold + active. Requires the api key tier to allow it
	// (rate-limit is enforced upstream, not here).
	const evaluate: CapabilityStatus = "ok";

	// Buy-side: needs bridge client paired AND user signed into eBay
	// in their browser. Order API approval (`EBAY_ORDER_API_APPROVED`)
	// is the alternative path that doesn't need the extension.
	const buy: CapabilityStatus = config.EBAY_ORDER_API_APPROVED
		? "ok"
		: !input.extensionPaired
			? "unavailable"
			: input.ebayLoggedIn
				? "ok"
				: "needs_signin";

	// Sell-side: passthrough requires the user's seller OAuth tokens.
	const sell: CapabilityStatus = input.sellerConnected ? "ok" : "needs_oauth";

	return { search, sold, detail, evaluate, buy, sell };
}

/**
 * Planet Express has no public API; everything goes through the user's
 * logged-in session via the Chrome extension. We don't track buyer-login
 * state per-forwarder yet — `needs_signin` would require a PE-specific
 * cookie/DOM probe in the content script. v1 reports `ok` whenever the
 * extension is paired and lets the actual call surface a real-time
 * "please sign in to planetexpress.com" if cookies are missing.
 */
function planetExpressCapabilities(input: { extensionPaired: boolean }): ForwarderCapabilities {
	const base: CapabilityStatus = input.extensionPaired ? "ok" : "unavailable";
	return {
		packages: base,
		consolidate: base,
		// Real money commit — interactive (user clicks). Status `ok` here
		// just means we can drive the UI; the user still confirms.
		ship: base,
	};
}
