/**
 * eBay splits its REST surface across two production hosts:
 *
 *   - `api.ebay.com`   — the bulk of Sell + Buy + Commerce
 *   - `apiz.ebay.com`  — Sell Finances, Commerce Identity, the
 *                        payment-dispute slice of Sell Fulfillment,
 *                        and a handful of newer / Limited Release pipes.
 *
 * Hitting these via `api.ebay.com` returns a no-envelope
 * `404 Content-Length: 0` (verified live 2026-05-02 for both Sell
 * Finances and Sell Fulfillment payment-dispute paths — same signature
 * as the Identity API misroute documented in `oauth.ts`). Routing by
 * path prefix here keeps callers (`services/money/*`,
 * `services/disputes/*`, the OAuth identity probe) unaware of the
 * host split.
 *
 * Note: only the `payment_dispute` slice of Sell Fulfillment lives on
 * apiz; `/sell/fulfillment/v1/order*` stays on api.ebay.com. We match
 * by path prefix (`/sell/fulfillment/v1/payment_dispute`) rather than
 * resource group.
 *
 * The `EBAY_BASE_URL` env still configures the api.ebay.com host
 * (and gets swapped to `api.sandbox.ebay.com` by the existing
 * env-override flow); the apiz host is derived from it by replacing
 * the leading `api.` with `apiz.`.
 */

import { config } from "../../config.js";

const APIZ_PREFIXES = [
	"/sell/finances/",
	"/commerce/identity/",
	"/sell/fulfillment/v1/payment_dispute",
	// Discovered 2026-05-03 by `scripts/ebay-path-sweep.ts`:
	"/sell/stores/v2/",
	"/buy/order/v1/",
];

export function ebayHostFor(path: string): string {
	const onApiz = APIZ_PREFIXES.some((p) => path.startsWith(p));
	if (!onApiz) return config.EBAY_BASE_URL;
	return config.EBAY_BASE_URL.replace(/^https?:\/\/api\./, "https://apiz.");
}
