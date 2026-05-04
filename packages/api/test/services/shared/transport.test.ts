import { describe, expect, it } from "vitest";
import {
	RESOURCE_TRANSPORTS,
	type ResourceTransports,
	selectTransport,
	TransportUnavailableError,
} from "../../../src/services/shared/transport.js";

describe("selectTransport", () => {
	describe("explicit transport choice", () => {
		it("returns the requested transport when capable", () => {
			expect(selectTransport("listings.search", { explicit: "scrape" })).toBe("scrape");
			expect(selectTransport("listings.search", { explicit: "rest" })).toBe("rest");
		});

		it("requires bridgePaired for bridge", () => {
			expect(() => selectTransport("listings.search", { explicit: "bridge", bridgePaired: false })).toThrow(
				TransportUnavailableError,
			);
			expect(selectTransport("listings.search", { explicit: "bridge", bridgePaired: true })).toBe("bridge");
		});

		it("requires oauthBound for user-rest", () => {
			expect(() => selectTransport("inventory.crud", { explicit: "rest", oauthBound: false })).toThrow(
				TransportUnavailableError,
			);
			expect(selectTransport("inventory.crud", { explicit: "rest", oauthBound: true })).toBe("rest");
		});

		it("requires appCredsConfigured for app-rest", () => {
			// listings.search rest:app — without eBay app creds REST is unreachable
			expect(() => selectTransport("listings.search", { explicit: "rest", appCredsConfigured: false })).toThrow(
				TransportUnavailableError,
			);
			expect(selectTransport("listings.search", { explicit: "rest", appCredsConfigured: true })).toBe("rest");
			// undefined (legacy callers) treated as configured — preserves
			// existing behavior where the field wasn't passed.
			expect(selectTransport("listings.search", { explicit: "rest" })).toBe("rest");
		});

		it("requires both envFlag and appCredsConfigured for sold rest", () => {
			// listings.sold rest:app + envFlag=EBAY_INSIGHTS_APPROVED
			expect(() =>
				selectTransport("listings.sold", {
					explicit: "rest",
					appCredsConfigured: true,
					envFlags: { EBAY_INSIGHTS_APPROVED: false },
				}),
			).toThrow(TransportUnavailableError);
			expect(() =>
				selectTransport("listings.sold", {
					explicit: "rest",
					appCredsConfigured: false,
					envFlags: { EBAY_INSIGHTS_APPROVED: true },
				}),
			).toThrow(TransportUnavailableError);
			expect(
				selectTransport("listings.sold", {
					explicit: "rest",
					appCredsConfigured: true,
					envFlags: { EBAY_INSIGHTS_APPROVED: true },
				}),
			).toBe("rest");
		});

		it("requires oauthBound for trading", () => {
			// `best-offer.respond` is still Trading-only — REST has no equivalent
			// for inbound seller offers. messages / feedback moved to REST
			// `commerce/*` in 2026-05; see notes/ebay-coverage.md G.1, G.2.
			expect(() => selectTransport("best-offer.respond", { explicit: "trading", oauthBound: false })).toThrow(
				TransportUnavailableError,
			);
			expect(selectTransport("best-offer.respond", { explicit: "trading", oauthBound: true })).toBe("trading");
		});

		it("rejects transports the resource doesn't support", () => {
			expect(() => selectTransport("best-offer.respond", { explicit: "rest" })).toThrow(TransportUnavailableError);
			expect(() => selectTransport("inventory.crud", { explicit: "scrape" })).toThrow(TransportUnavailableError);
		});
	});

	describe("env default fallback", () => {
		it("uses envDefault when capable", () => {
			expect(selectTransport("listings.search", { envDefault: "scrape" })).toBe("scrape");
		});

		it("falls through to auto when envDefault not capable", () => {
			// envDefault=bridge but no pairing → auto picks rest (app)
			expect(selectTransport("listings.search", { envDefault: "bridge", bridgePaired: false })).toBe("rest");
		});
	});

	describe("auto selection", () => {
		it("prefers app-rest when configured (cheapest, anonymous)", () => {
			expect(selectTransport("listings.search", { appCredsConfigured: true })).toBe("rest");
			expect(selectTransport("markets.taxonomy", { appCredsConfigured: true })).toBe("rest");
		});

		it("falls through to scrape when app creds not configured", () => {
			// Browse and sold are now symmetric — both auto-pick scrape when
			// flipagent's eBay app credentials are missing. Self-hosters who
			// didn't set EBAY_CLIENT_ID still get a working read path.
			expect(selectTransport("listings.search", { appCredsConfigured: false })).toBe("scrape");
			expect(selectTransport("listings.detail", { appCredsConfigured: false })).toBe("scrape");
			expect(selectTransport("listings.sold", { appCredsConfigured: false })).toBe("scrape");
		});

		it("falls through to scrape when sold is not Insights-approved", () => {
			// Same shape as app-creds missing — sold's REST is gated by
			// EBAY_INSIGHTS_APPROVED, falls through to scrape when unset.
			expect(
				selectTransport("listings.sold", {
					appCredsConfigured: true,
					envFlags: { EBAY_INSIGHTS_APPROVED: false },
				}),
			).toBe("scrape");
			expect(
				selectTransport("listings.sold", {
					appCredsConfigured: true,
					envFlags: { EBAY_INSIGHTS_APPROVED: true },
				}),
			).toBe("rest");
		});

		it("prefers user-rest when oauth bound and no app-rest", () => {
			expect(selectTransport("inventory.crud", { oauthBound: true })).toBe("rest");
			expect(selectTransport("fulfillment.read", { oauthBound: true })).toBe("rest");
		});

		it("falls back to scrape for app-rest+scrape resources without app-rest preference", () => {
			// listings.* have rest:app — app-rest wins. Sold also has rest:app but
			// real callers may flip env to scrape (Marketplace Insights cap).
			expect(selectTransport("listings.sold", { envDefault: "scrape" })).toBe("scrape");
		});

		it("falls back to trading for trading-only resources when oauth bound", () => {
			// Best Offer (inbound) is the last surface still Trading-only —
			// REST has no equivalent for reading/responding to inbound seller
			// offers. messages / feedback both migrated to REST commerce/* in
			// 2026-05.
			expect(selectTransport("best-offer.list", { oauthBound: true })).toBe("trading");
			expect(selectTransport("best-offer.respond", { oauthBound: true })).toBe("trading");
		});

		it("picks user-rest for messages / feedback (post-Trading migration)", () => {
			// Sanity check that the migration off Trading actually shows up in
			// the selector — these used to fall through to trading; now REST
			// commerce/* serves them.
			expect(selectTransport("messages.list", { oauthBound: true })).toBe("rest");
			expect(selectTransport("messages.send", { oauthBound: true })).toBe("rest");
			expect(selectTransport("feedback.list", { oauthBound: true })).toBe("rest");
			expect(selectTransport("feedback.leave", { oauthBound: true })).toBe("rest");
		});

		it("uses bridge for bridge-only resources when paired", () => {
			expect(selectTransport("orders.checkout", { bridgePaired: true })).toBe("bridge");
			expect(selectTransport("inbox.watching", { bridgePaired: true })).toBe("bridge");
			expect(selectTransport("inbox.cases", { bridgePaired: true })).toBe("bridge");
		});

		it("throws when no transport is available", () => {
			// orders.checkout is bridge-only when no rest creds + no env flag
			expect(() => selectTransport("orders.checkout", { bridgePaired: false })).toThrow(TransportUnavailableError);
			// messages.list is trading-only — needs oauth
			expect(() => selectTransport("messages.list", { oauthBound: false })).toThrow(TransportUnavailableError);
			// inventory.crud is rest:user — needs oauth
			expect(() => selectTransport("inventory.crud", { oauthBound: false })).toThrow(TransportUnavailableError);
			// markets.taxonomy is rest:app only (no scrape) — fails without app creds
			expect(() => selectTransport("markets.taxonomy", { appCredsConfigured: false })).toThrow(
				TransportUnavailableError,
			);
		});
	});

	describe("RESOURCE_TRANSPORTS shape", () => {
		it("declares at least one transport for every resource", () => {
			for (const [resource, raw] of Object.entries(RESOURCE_TRANSPORTS)) {
				const caps = raw as ResourceTransports;
				const has = caps.rest || caps.scrape || caps.bridge || caps.trading;
				expect(has, `resource ${resource} declares zero transports`).toBeTruthy();
			}
		});

		it("declares dual rest+bridge resources explicitly (sanity check on the matrix)", () => {
			const dual: string[] = [];
			for (const [resource, raw] of Object.entries(RESOURCE_TRANSPORTS)) {
				const caps = raw as ResourceTransports;
				if (caps.bridge && caps.rest) dual.push(resource);
			}
			// listings.{search,sold,detail} — anonymous-read resources
			// where bridge is an alternative to scrape/rest.
			// orders.checkout — eBay Buy Order: rest gated by Limited
			// Release env, bridge always available; both first-class.
			// bids.{place,status} — Buy Offer mirrors orders.checkout:
			// rest gated by EBAY_BIDDING_APPROVED, bridge always available
			// when the extension is paired.
			expect(dual.sort()).toEqual([
				"bids.place",
				"bids.status",
				"listings.detail",
				"listings.search",
				"listings.sold",
				"orders.checkout",
			]);
		});
	});
});
