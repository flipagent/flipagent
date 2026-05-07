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
import { planetExpressSignupUrl } from "./forwarder.js";

/**
 * Every kind here represents an action the **caller** (the agent or end
 * user) can take to unblock themselves. Operator-side concerns (server
 * env config, REST program approvals, …) never appear here — those
 * surface as plain 503/412 with a clean message and live on
 * `/v1/health` for operators to inspect, not on consumer responses.
 */
export type NextActionKind =
	| "ebay_oauth" // caller must run /v1/connect/ebay
	| "extension_install" // user must install + pair the Chrome extension (PE inbox / authenticated reads only)
	| "open_url" // human-driven action: agent should open `url` for the user to click through (Buy It Now, Place Bid, forwarder dispatch). Service supplies a per-call URL + instructions via `openUrlAction()`.
	| "forwarder_signin" // user must re-sign-in to the forwarder (PE) — session expired
	| "forwarder_signup" // user has no PE account — direct them to sign up (referral-attributed)
	| "setup_seller_policies"; // agent must collect prefs + POST /v1/policies/setup

export interface NextAction {
	readonly kind: NextActionKind;
	readonly url: string;
	readonly instructions: string;
}

/**
 * Build an `open_url` NextAction with caller-supplied url + instructions.
 * Used by deeplink-transport surfaces (`/v1/purchases`, `/v1/bids`,
 * forwarder dispatch) where the URL varies per call.
 */
export function openUrlAction(url: string, instructions: string): NextAction {
	return { kind: "open_url", url, instructions };
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
		case "open_url":
			// `open_url` is built at the call site via `openUrlAction(url,
			// instructions)` because the URL varies per call. This branch
			// exists only so the static map stays exhaustive — the caller
			// should never invoke `nextAction(c, "open_url")` directly.
			return {
				kind,
				url: "",
				instructions: "Use openUrlAction(url, instructions) to build this NextAction.",
			};
		case "forwarder_signin":
			return {
				kind,
				url: "https://app.planetexpress.com/sign/in",
				instructions:
					"The user's Planet Express session has expired (PE auto-signs out after ~30 minutes of inactivity). Direct them to sign back in at this URL, then re-call the tool. This is normal — PE doesn't have a long-lived auth token, so re-sign-in is expected at ship time.",
			};
		case "forwarder_signup":
			return {
				kind,
				url: planetExpressSignupUrl(),
				instructions:
					"The user does not have a Planet Express account yet. Direct them to sign up at this URL — they'll get a US warehouse address that flipagent can use as the eBay ship-from. Once their account is active and they're signed in to planetexpress.com in the Chrome profile their extension is paired with, re-call the tool.",
			};
		case "setup_seller_policies":
			return {
				kind,
				url: `${origin}/v1/policies/setup`,
				instructions:
					"Cannot list — the seller's eBay account is missing return and/or fulfillment policies. Ask the user 5 quick questions and POST /v1/policies/setup (MCP: flipagent_create_seller_policies) with their answers — the call is idempotent and only creates what's missing. Questions: (1) Accept returns? (2) If yes, return window — 14, 30, or 60 days? (3) If yes, who pays return shipping — buyer or seller? (4) Handling time — business days from sale to shipment, typically 1-3? (5) Shipping mode — free / flat-rate (cents) / calculated by carrier? Plus shipping service code (USPSPriority is the safe default; USPSGroundAdvantage works for most accounts; UPSGround / FedExGround are alternatives). Acceptable to offer the user a 'use defaults' shortcut: 30-day buyer-pays returns, 1-day handling, free USPSPriority — but show those values explicitly, not silently.",
			};
	}
}
