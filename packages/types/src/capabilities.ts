/**
 * `/v1/capabilities` — agent's first-call discovery surface. Tells the
 * agent which marketplaces are reachable and at which fidelity:
 *
 *   ok                  — the call works for this api key right now.
 *   needs_signin        — backed by the bridge client (Chrome extension)
 *                         but the user isn't signed into the marketplace
 *                         in their browser yet.
 *   needs_oauth         — needs the user's seller OAuth handshake
 *                         (`/v1/connect/{marketplace}`).
 *   approval_pending    — the underlying marketplace API is gated and
 *                         we're waiting on tenant approval (e.g. eBay
 *                         Order API, Marketplace Insights).
 *   scrape_fallback     — first-class API not available; we serve a
 *                         best-effort scraped result.
 *   unavailable         — the host instance hasn't been configured for
 *                         this capability (env vars unset).
 *
 * Agents should call this once at session start and decide which
 * tools to attempt. `client.extensionPaired` controls whether buy-side
 * is even possible for this api key.
 */

import { type Static, Type } from "@sinclair/typebox";

export const CapabilityStatus = Type.Union(
	[
		Type.Literal("ok"),
		Type.Literal("needs_signin"),
		Type.Literal("needs_oauth"),
		Type.Literal("approval_pending"),
		Type.Literal("scrape_fallback"),
		Type.Literal("unavailable"),
	],
	{ $id: "CapabilityStatus" },
);
export type CapabilityStatus = Static<typeof CapabilityStatus>;

export const MarketplaceId = Type.Union([Type.Literal("ebay")], { $id: "MarketplaceId" });
export type MarketplaceId = Static<typeof MarketplaceId>;

export const ForwarderId = Type.Union([Type.Literal("planetexpress")], { $id: "ForwarderId" });
export type ForwarderId = Static<typeof ForwarderId>;

export const MarketplaceCapabilities = Type.Object(
	{
		/** Active-listing search (`/v1/listings/search`). */
		search: CapabilityStatus,
		/** Sold-comp search (`/v1/sold/search`). For eBay, scrape fallback when Marketplace Insights unapproved. */
		sold: CapabilityStatus,
		/** Single-listing detail (`/v1/listings/{id}`). */
		detail: CapabilityStatus,
		/** Score one listing (`/v1/evaluate`). */
		evaluate: CapabilityStatus,
		/** Buyer-side checkout (`/v1/orders/checkout`). Requires bridge client paired + buyer signed in. */
		buy: CapabilityStatus,
		/** Sell-side passthrough (`/v1/inventory`, `/v1/fulfillment`, `/v1/finance`). Requires seller OAuth. */
		sell: CapabilityStatus,
	},
	{ $id: "MarketplaceCapabilities" },
);
export type MarketplaceCapabilities = Static<typeof MarketplaceCapabilities>;

/**
 * Forwarder capabilities — Planet Express, MyUS, Stackry, etc. Most have
 * no public API; flipagent reads via the user's logged-in session through
 * the Chrome extension. Auto-actions (read packages) are safe; money
 * commits (ship-to-destination $30~100) are interactive (user clicks).
 */
export const ForwarderCapabilities = Type.Object(
	{
		/** List incoming + on-hand packages. Requires bridge client + user signed in to forwarder. */
		packages: CapabilityStatus,
		/** Request consolidate (small fee, mostly automatic). */
		consolidate: CapabilityStatus,
		/** Ship to destination (real money — interactive only). */
		ship: CapabilityStatus,
	},
	{ $id: "ForwarderCapabilities" },
);
export type ForwarderCapabilities = Static<typeof ForwarderCapabilities>;

export const CapabilitiesResponse = Type.Object(
	{
		client: Type.Object({
			extensionPaired: Type.Boolean(),
			deviceName: Type.Union([Type.String(), Type.Null()]),
			lastSeenAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
		}),
		marketplaces: Type.Object({
			ebay: MarketplaceCapabilities,
		}),
		forwarders: Type.Object({
			planetexpress: ForwarderCapabilities,
		}),
		generatedAt: Type.String({ format: "date-time" }),
	},
	{ $id: "CapabilitiesResponse" },
);
export type CapabilitiesResponse = Static<typeof CapabilitiesResponse>;
