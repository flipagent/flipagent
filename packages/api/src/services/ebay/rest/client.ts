/**
 * Generic eBay passthrough — forward the caller's request to api.ebay.com,
 * inject the right OAuth Bearer (user-token or app-token), stream the response
 * back. Reused by every `/sell/*`, `/buy/order/*`, `/commerce/*`, and the
 * Browse read endpoints when EBAY_CLIENT_ID is configured.
 *
 *   - `ebayPassthroughUser` — needs the caller's stored eBay refresh token
 *     (sell-side, Order API). Returns 401 not_connected if missing.
 *   - `ebayPassthroughApp`  — uses flipagent's app-credential token (Browse,
 *     Marketplace Insights, Taxonomy). Returns 503 if EBAY_CLIENT_ID unset.
 *
 * Errors flipagent itself produces (not_configured, not_connected, …) match
 * eBay's error envelope shape so caller SDKs route them through the same
 * error handler as upstream eBay errors. eBay's actual upstream errors are
 * forwarded verbatim — already in the right shape.
 */

import type { Context } from "hono";
import { config, isEbayOAuthConfigured } from "../../../config.js";
import { getAppAccessToken, getUserAccessToken } from "../../../services/ebay/oauth.js";
import { ebayErrorJson, FLIPAGENT_ERRORS } from "../../../utils/ebay-error.js";
import { fetchRetry } from "../../../utils/fetch-retry.js";

const HOP_BY_HOP = new Set([
	"connection",
	"keep-alive",
	"transfer-encoding",
	"upgrade",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"content-encoding", // upstream may gzip; node refetch decodes — drop the header
	"content-length", // recomputed by Hono
]);

// Map flipagent's unified `/v1/*` surface to eBay's verbose REST paths.
// Public surface mirrors eBay's REST path structure under
// `/v1/{buy,sell,commerce,post-order}/...`. The PATH_MAP rewrites our
// `/v1/<group>/<resource>/...` to eBay's verbose `/buy/<resource>/v1/...`
// so we don't drag eBay's per-API version segments into the public
// surface. Order matters — longer prefixes first within a group.
const PATH_MAP: Array<[RegExp, string]> = [
	// Buy-side
	[/^\/v1\/buy\/order\/checkout_session/, "/buy/order/v1/checkout_session"],
	[/^\/v1\/buy\/order\/guest_checkout_session/, "/buy/order/v2/guest_checkout_session"],
	[/^\/v1\/buy\/browse\/item_summary\/search/, "/buy/browse/v1/item_summary/search"],
	[/^\/v1\/buy\/browse\/item/, "/buy/browse/v1/item"],
	[/^\/v1\/buy\/marketplace_insights\/item_sales\/search/, "/buy/marketplace_insights/v1_beta/item_sales/search"],
	[/^\/v1\/buy\/feed/, "/buy/feed/v1_beta"],
	[/^\/v1\/buy\/deal/, "/buy/deal/v1"],
	[/^\/v1\/buy\/offer/, "/buy/offer/v1"],
	// Sell-side
	[/^\/v1\/sell\/inventory/, "/sell/inventory/v1"],
	[/^\/v1\/sell\/fulfillment/, "/sell/fulfillment/v1"],
	[/^\/v1\/sell\/finances/, "/sell/finances/v1"],
	[/^\/v1\/sell\/account/, "/sell/account/v1"],
	[/^\/v1\/sell\/marketing/, "/sell/marketing/v1"],
	[/^\/v1\/sell\/negotiation/, "/sell/negotiation/v1"],
	[/^\/v1\/sell\/analytics/, "/sell/analytics/v1"],
	[/^\/v1\/sell\/compliance/, "/sell/compliance/v1"],
	[/^\/v1\/sell\/recommendation/, "/sell/recommendation/v1"],
	[/^\/v1\/sell\/logistics/, "/sell/logistics/v1_beta"],
	[/^\/v1\/sell\/stores/, "/sell/stores/v2"],
	[/^\/v1\/sell\/feed/, "/sell/feed/v1"],
	[/^\/v1\/sell\/metadata/, "/sell/metadata/v1"],
	// Commerce — cross-cutting reference data
	[/^\/v1\/commerce\/taxonomy/, "/commerce/taxonomy/v1"],
	[/^\/v1\/commerce\/catalog/, "/commerce/catalog/v1_beta"],
	[/^\/v1\/commerce\/identity/, "/commerce/identity/v1"],
	[/^\/v1\/commerce\/translation/, "/commerce/translation/v1"],
	// Post-order — returns / cases / cancellations / inquiries / issues
	[/^\/v1\/post-order/, "/post-order/v2"],
];

function translatePath(path: string): string {
	for (const [pattern, replacement] of PATH_MAP) {
		if (pattern.test(path)) return path.replace(pattern, replacement);
	}
	return path;
}

async function forward(c: Context, accessToken: string): Promise<Response> {
	const upstreamUrl = new URL(translatePath(c.req.path), config.EBAY_BASE_URL);
	const queryStart = c.req.url.indexOf("?");
	if (queryStart !== -1) upstreamUrl.search = c.req.url.slice(queryStart);

	const headers: Record<string, string> = {
		Authorization: `Bearer ${accessToken}`,
		Accept: "application/json",
	};
	const ct = c.req.header("Content-Type");
	if (ct) headers["Content-Type"] = ct;
	const lang = c.req.header("Accept-Language");
	if (lang) headers["Accept-Language"] = lang;
	const marketplaceId = c.req.header("X-EBAY-C-MARKETPLACE-ID");
	if (marketplaceId) headers["X-EBAY-C-MARKETPLACE-ID"] = marketplaceId;
	const endUserCtx = c.req.header("X-EBAY-C-ENDUSERCTX");
	if (endUserCtx) headers["X-EBAY-C-ENDUSERCTX"] = endUserCtx;

	const init: RequestInit = { method: c.req.method, headers };
	if (c.req.method !== "GET" && c.req.method !== "HEAD") {
		init.body = await c.req.arrayBuffer();
	}

	const upstream = await fetchRetry(upstreamUrl, init);
	const responseHeaders = new Headers();
	upstream.headers.forEach((v, k) => {
		if (!HOP_BY_HOP.has(k.toLowerCase())) responseHeaders.set(k, v);
	});
	responseHeaders.set("X-Flipagent-Source", "ebay-passthrough");
	const buf = await upstream.arrayBuffer();
	return new Response(buf, {
		status: upstream.status,
		statusText: upstream.statusText,
		headers: responseHeaders,
	});
}

export async function ebayPassthroughUser(c: Context): Promise<Response> {
	if (!isEbayOAuthConfigured()) {
		return ebayErrorJson(c, FLIPAGENT_ERRORS.notConfigured(), 503);
	}
	const apiKey = c.get("apiKey");
	let token: string;
	try {
		token = await getUserAccessToken(apiKey.id);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg === "not_connected") {
			return ebayErrorJson(c, FLIPAGENT_ERRORS.notConnected(), 401);
		}
		return ebayErrorJson(c, FLIPAGENT_ERRORS.tokenRefreshFailed(msg), 502);
	}
	try {
		return await forward(c, token);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return ebayErrorJson(c, FLIPAGENT_ERRORS.upstreamFailed(msg), 502);
	}
}

export async function ebayPassthroughApp(c: Context): Promise<Response> {
	if (!isEbayOAuthConfigured()) {
		return ebayErrorJson(c, FLIPAGENT_ERRORS.notConfigured(), 503);
	}
	let token: string;
	try {
		token = await getAppAccessToken();
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return ebayErrorJson(c, FLIPAGENT_ERRORS.appTokenFailed(msg), 502);
	}
	try {
		return await forward(c, token);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return ebayErrorJson(c, FLIPAGENT_ERRORS.upstreamFailed(msg), 502);
	}
}

/**
 * Order API gate. Even when the user has connected eBay, we hold the route
 * at 501 until `EBAY_ORDER_API_APPROVED=1`. Flip the env once eBay's tenant
 * approval lands.
 */
export async function ebayPassthroughOrderApi(c: Context): Promise<Response> {
	if (!config.EBAY_ORDER_API_APPROVED) {
		return ebayErrorJson(c, FLIPAGENT_ERRORS.orderApiPending(), 501);
	}
	return ebayPassthroughUser(c);
}
