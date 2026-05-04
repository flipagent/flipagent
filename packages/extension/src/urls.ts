/**
 * URL builders + dashboard path constants. Keeps the
 * `${BASE.replace(/\/+$/, "")}${path}` boilerplate out of every
 * caller and makes the dashboard's URL surface auditable in one
 * place.
 *
 * `DEFAULT_DASHBOARD_BASE_URL` itself is a build-time constant set
 * from `__FLIPAGENT_DASHBOARD_BASE__` (see build.mjs / globals.d.ts);
 * dev builds bake `http://localhost:4321`, prod bakes
 * `https://flipagent.dev`.
 */

import { DEFAULT_DASHBOARD_BASE_URL } from "./shared.js";

/** Dashboard paths used by the extension. Keep slugs in sync with
 * `apps/docs/src/pages/extension/*.astro` and the dashboard's own
 * single-page routes. Trailing slashes match Astro's output. */
export const DASHBOARD_PATHS = {
	/** Sign-in / device-pairing landing page; receives `?ext={runtime.id}` so it can post credentials back. */
	CONNECT: "/extension/connect/",
	/** iframe-embedded result surface; receives evaluate payloads via postMessage. */
	RESULT: "/extension/result/",
	/** Public marketing pricing + checkout. Server falls back to this when Stripe isn't wired and no `upgrade` URL came back on the 429 body. */
	PRICING: "/pricing/",
	/** Logged-in dashboard SPA root. */
	DASHBOARD: "/dashboard",
} as const;

/** Build a dashboard URL — strips trailing slashes from the base so we
 * never emit `https://flipagent.dev//pricing/`. */
export function dashboardUrl(path: string): string {
	return `${DEFAULT_DASHBOARD_BASE_URL.replace(/\/+$/, "")}${path}`;
}

/** Build the OAuth handoff URL the popup / chip opens to onboard a
 * device. The connect page picks up `ext` to post credentials back via
 * `chrome.runtime.sendMessage(extId, …)`; `device` lets the user
 * recognise this Chrome on the dashboard's Connected Devices list. */
export function connectUrl(extensionId: string, deviceName?: string): string {
	const qs = new URLSearchParams({ ext: extensionId });
	if (deviceName) qs.set("device", deviceName);
	return `${dashboardUrl(DASHBOARD_PATHS.CONNECT)}?${qs.toString()}`;
}

/** eBay's hosted sign-in URL with `ru=` (return-url) so the user lands
 * back on whichever page they triggered the sign-in from. eBay strips
 * off-domain `ru` values, so this only works when the caller is
 * already on ebay.com. */
export function ebaySigninUrl(returnUrl: string): string {
	return `https://signin.ebay.com/ws/eBayISAPI.dll?SignIn&ru=${encodeURIComponent(returnUrl)}`;
}
