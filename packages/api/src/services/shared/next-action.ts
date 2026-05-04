/**
 * `next_action` is the standard remediation field on flipagent error
 * responses. When a route returns a non-2xx that the caller can fix
 * (OAuth not done, Chrome extension not paired, server-side env not
 * configured, …), the body carries `next_action: { kind, url,
 * instructions }`. Clients (the MCP server in particular) render
 * `instructions` to the LLM agent verbatim — no client-side guesswork
 * about which OAuth URL or install link applies.
 *
 * The api is the source of truth: routes know their own prereqs, so
 * they tag the error and the global onError handler builds the
 * absolute URL from the request origin.
 */

import type { Context } from "hono";

export type NextActionKind =
	| "ebay_oauth" // caller must run /v1/connect/ebay
	| "extension_install" // user must install + pair the Chrome extension
	| "rest_or_extension" // either flag is enough — used by /v1/purchases
	| "forwarder_signin" // user must re-sign-in to the forwarder (PE) — session expired
	| "setup_seller_policies" // agent must collect prefs + POST /v1/policies/setup
	| "configure_ebay" // operator must set EBAY_CLIENT_ID/SECRET/RU_NAME
	| "configure_bidding_api" // either operator sets EBAY_BIDDING_APPROVED=1 after Buy Offer LR approval, or end user pairs the Chrome extension
	| "configure_stripe"; // operator must set STRIPE_* env

export interface NextAction {
	readonly kind: NextActionKind;
	readonly url: string;
	readonly instructions: string;
}

const EXTENSION_DOCS = "https://flipagent.dev/docs/extension/";

/**
 * Build a NextAction for the given kind, using the request's origin to
 * absolute-ize any flipagent-internal URLs (so self-hosted instances
 * point at their own host, not api.flipagent.dev).
 */
export function nextAction(c: Context, kind: NextActionKind): NextAction {
	const origin = new URL(c.req.url).origin;
	switch (kind) {
		case "ebay_oauth":
			return {
				kind,
				url: `${origin}/v1/connect/ebay`,
				instructions:
					"Direct the user to this URL in their browser to authorize their eBay seller account. Once they finish, re-call the tool.",
			};
		case "extension_install":
			return {
				kind,
				url: EXTENSION_DOCS,
				instructions:
					"Direct the user to install the flipagent Chrome extension at this URL and pair it with their api key (one-time, via the extension's popup — click the toolbar icon). Re-call the tool once paired.",
			};
		case "rest_or_extension":
			return {
				kind,
				url: EXTENSION_DOCS,
				instructions:
					"Direct the user to install the flipagent Chrome extension and pair it with their api key — purchases will then drive through their logged-in eBay session. Alternatively the api operator can set EBAY_ORDER_APPROVED=1 to use eBay's Buy Order REST API.",
			};
		case "forwarder_signin":
			return {
				kind,
				url: "https://app.planetexpress.com/sign/in",
				instructions:
					"The user's Planet Express session has expired (PE auto-signs out after ~30 minutes of inactivity). Direct them to sign back in at this URL, then re-call the tool. This is normal — PE doesn't have a long-lived auth token, so re-sign-in is expected at ship time.",
			};
		case "setup_seller_policies":
			return {
				kind,
				url: `${origin}/v1/policies/setup`,
				instructions:
					"Cannot list — the seller's eBay account is missing return and/or fulfillment policies. Ask the user 5 quick questions and POST /v1/policies/setup (MCP: flipagent_create_seller_policies) with their answers — the call is idempotent and only creates what's missing. Questions: (1) Accept returns? (2) If yes, return window — 14, 30, or 60 days? (3) If yes, who pays return shipping — buyer or seller? (4) Handling time — business days from sale to shipment, typically 1-3? (5) Shipping mode — free / flat-rate (cents) / calculated by carrier? Plus shipping service code (USPSPriority is the safe default; USPSGroundAdvantage works for most accounts; UPSGround / FedExGround are alternatives). Acceptable to offer the user a 'use defaults' shortcut: 30-day buyer-pays returns, 1-day handling, free USPSPriority — but show those values explicitly, not silently.",
			};
		case "configure_ebay":
			return {
				kind,
				url: `${origin}/v1/health`,
				instructions:
					"The api operator must set EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, and EBAY_RU_NAME before any eBay-bound flow can run. This is a server config issue, not something the end user can fix.",
			};
		case "configure_bidding_api":
			return {
				kind,
				url: EXTENSION_DOCS,
				instructions:
					"Direct the user to install the flipagent Chrome extension and pair it with their api key — auction bids will then drive through their logged-in eBay session (the bridge clicks Place Bid on ebay.com). Alternatively the api operator can apply at developer.ebay.com → Buy APIs → Buy Offer for Limited Release access and set EBAY_BIDDING_APPROVED=1 to use eBay's REST surface instead.",
			};
		case "configure_stripe":
			return {
				kind,
				url: `${origin}/v1/health`,
				instructions:
					"The api operator must set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and STRIPE_PRICE_* before billing flows can run. This is a server config issue, not something the end user can fix.",
			};
	}
}
