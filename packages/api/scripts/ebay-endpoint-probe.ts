/**
 * End-to-end live probe of every eBay endpoint flipagent wraps.
 *
 * Refreshes the stored user OAuth via `getUserAccessToken`, then sweeps
 * every REST + Trading + Post-Order path we have a wrapper for. Records
 * status code, errorId (when present), and a short payload snapshot
 * into `notes/ebay-endpoint-probe-results.json`. Output is what feeds
 * Section 8 of `notes/ebay-endpoints.md` — every "OK 2026-MM-DD" row in
 * the maintenance table came out of this script.
 *
 * Run:
 *   cd packages/api && node --env-file=.env --import tsx scripts/ebay-endpoint-probe.ts
 *
 * Optional:
 *   APIKEY_ID=<uuid>   target a specific key (default: first key with an eBay binding)
 *   ONLY=finances,bids only run probes whose tag matches a comma list
 */

import { writeFileSync } from "node:fs";
import { desc } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { userEbayOauth } from "../src/db/schema.js";
import { ebayHostFor } from "../src/services/ebay/host.js";
import { getAppAccessToken, getUserAccessToken } from "../src/services/ebay/oauth.js";

interface ProbeResult {
	tag: string;
	method: string;
	path: string;
	host: string;
	status: number;
	errorId?: number;
	message?: string;
	body?: unknown;
}

interface ProbeSpec {
	tag: string;
	method?: "GET" | "POST";
	path: string;
	body?: unknown;
	auth: "user" | "user-iaf" | "app";
	marketplace?: string;
}

const PROBES: ProbeSpec[] = [
	// Account
	{ tag: "account", path: "/sell/account/v1/privilege", auth: "user" },
	{ tag: "account", path: "/sell/account/v1/kyc", auth: "user" },
	{ tag: "account", path: "/sell/account/v1/subscription", auth: "user" },
	{ tag: "account", path: "/sell/account/v1/payments_program/EBAY_US/EBAY_PAYMENTS", auth: "user" },
	{ tag: "account", path: "/sell/account/v1/advertising_eligibility", auth: "user", marketplace: "EBAY_US" },
	{ tag: "account", path: "/sell/account/v1/program/get_opted_in_programs", auth: "user" },
	{ tag: "account", path: "/sell/account/v1/rate_table", auth: "user" },
	{ tag: "account", path: "/sell/account/v1/custom_policy", auth: "user", marketplace: "EBAY_US" },
	{ tag: "account", path: "/sell/account/v1/sales_tax?country_code=US", auth: "user" },
	// Inventory
	{ tag: "inventory", path: "/sell/inventory/v1/inventory_item?limit=1", auth: "user" },
	{ tag: "inventory", path: "/sell/inventory/v1/location?limit=1", auth: "user" },
	{ tag: "inventory", path: "/sell/inventory/v1/inventory_item_group?limit=1", auth: "user" },
	{ tag: "inventory", path: "/sell/inventory/v1/offer?sku=__no_such__", auth: "user", marketplace: "EBAY_US" },
	// Fulfillment
	{ tag: "fulfillment", path: "/sell/fulfillment/v1/order?limit=1", auth: "user" },
	{
		tag: "fulfillment",
		path: "/sell/fulfillment/v1/payment_dispute_summary?look_back_days=30",
		auth: "user",
	},
	// Marketing
	{ tag: "marketing", path: "/sell/marketing/v1/ad_campaign?limit=1", auth: "user", marketplace: "EBAY_US" },
	{ tag: "marketing", path: "/sell/marketing/v1/ad_report_metadata", auth: "user", marketplace: "EBAY_US" },
	{ tag: "marketing", path: "/sell/marketing/v1/promotion?marketplace_id=EBAY_US&limit=1", auth: "user" },
	{
		tag: "marketing",
		path: "/sell/marketing/v1/promotion?marketplace_id=EBAY_US&promotion_type=MARKDOWN_SALE&limit=1",
		auth: "user",
	},
	{
		tag: "marketing",
		path: "/sell/marketing/v1/promotion_summary_report?marketplace_id=EBAY_US",
		auth: "user",
	},
	// Compliance
	{ tag: "compliance", path: "/sell/compliance/v1/listing_violation_summary", auth: "user", marketplace: "EBAY_US" },
	// Metadata
	{
		tag: "metadata",
		path: "/sell/metadata/v1/marketplace/EBAY_US/get_return_policies",
		auth: "user",
	},
	{
		tag: "metadata",
		path: "/sell/metadata/v1/marketplace/EBAY_US/get_listing_structure_policies",
		auth: "user",
	},
	{ tag: "metadata", path: "/sell/metadata/v1/country/US/sales_tax_jurisdiction", auth: "user" },
	// Recommendations (POST find). marketplace_id uses HYPHEN form
	// (`EBAY-US`) on this endpoint specifically — every other Sell API
	// uses underscore (`EBAY_US`).
	{
		tag: "recommendations",
		method: "POST",
		path: "/sell/recommendation/v1/find?marketplace_id=EBAY-US&limit=1",
		body: { listingIds: ["v123"] },
		auth: "user",
		marketplace: "EBAY-US",
	},
	// Negotiation
	{ tag: "negotiation", path: "/sell/negotiation/v1/find_eligible_items", auth: "user", marketplace: "EBAY_US" },
	// Stores (REST gated; expect 403)
	{ tag: "stores", path: "/sell/stores/v1/store", auth: "user", marketplace: "EBAY_US" },
	// Finances (THE apiz fix)
	{ tag: "finances", path: "/sell/finances/v1/payout?limit=1", auth: "user" },
	{
		tag: "finances",
		path: "/sell/finances/v1/payout_summary?filter=payoutDate:[2025-01-01T00:00:00.000Z..2026-05-02T00:00:00.000Z]",
		auth: "user",
	},
	{ tag: "finances", path: "/sell/finances/v1/transaction?limit=1", auth: "user" },
	{ tag: "finances", path: "/sell/finances/v1/transfer?limit=1", auth: "user" },
	// Logistics (needs sell.logistics scope; expect 403 until re-consent)
	{ tag: "logistics", path: "/sell/logistics/v1_beta/shipment/__no_such__", auth: "user" },
	// Buy Order (Limited Release; expect 403/404 unless approved)
	{ tag: "buy-order", path: "/buy/order/v2/checkout_session/__no_such__", auth: "user" },
	// Buy Offer bidding (now v1_beta) — expect 400 ACCESS on fake itemId (= endpoint reachable)
	{
		tag: "buy-offer",
		method: "POST",
		path: "/buy/offer/v1_beta/bidding/v123/place_proxy_bid",
		body: { maxAmount: { value: "1.00", currency: "USD" }, userConsent: { adultItems: false } },
		auth: "user",
	},
	{ tag: "buy-offer", path: "/buy/offer/v1_beta/bidding/v123", auth: "user" },
	// Commerce Identity (apiz host)
	{ tag: "identity", path: "/commerce/identity/v1/user/", auth: "user" },
	// Commerce Message
	{ tag: "message", path: "/commerce/message/v1/conversation", auth: "user" },
	// Commerce Feedback — exact wrapper shape from
	// services/ebay/rest/feedback.ts (user_id + feedback_type +
	// filter=role:SELLER). Param name is `user_id`, not the
	// intuitive `seller_username` (that returns errorId 501000).
	{
		tag: "feedback",
		path: "/commerce/feedback/v1/feedback?user_id=sprd-shop&feedback_type=FEEDBACK_RECEIVED&filter=role:SELLER&limit=1",
		auth: "user",
		marketplace: "EBAY_US",
	},
	{
		tag: "feedback",
		path: "/commerce/feedback/v1/awaiting_feedback?limit=1",
		auth: "user",
		marketplace: "EBAY_US",
	},
	// Commerce Notification
	{ tag: "notification", path: "/commerce/notification/v1/topic", auth: "user" },
	{ tag: "notification", path: "/commerce/notification/v1/destination", auth: "user" },
	{ tag: "notification", path: "/commerce/notification/v1/subscription", auth: "user" },
	{ tag: "notification", path: "/commerce/notification/v1/config", auth: "user" },
	// Commerce Translation (v1_beta)
	{
		tag: "translation",
		method: "POST",
		path: "/commerce/translation/v1_beta/translate",
		body: { from: "en", to: "fr", text: ["hello"], translationContext: "ITEM_TITLE" },
		auth: "user",
	},
	// Commerce Charity. App-credential token returns errorId 165001
	// (the API is gated by user OAuth at the app level for non-approved
	// apps). User OAuth + the X-EBAY-C-MARKETPLACE-ID header is
	// sufficient.
	{
		tag: "charity",
		path: "/commerce/charity/v1/charity_org?q=red+cross&limit=2",
		auth: "user",
		marketplace: "EBAY_US",
	},
	{
		tag: "charity",
		path: "/commerce/charity/v1/charity_org?registration_ids=53-0196605&limit=2",
		auth: "user",
		marketplace: "EBAY_US",
	},
	// Commerce Taxonomy
	{
		tag: "taxonomy",
		path: "/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_US",
		auth: "app",
	},
	// Buy Browse
	{ tag: "browse", path: "/buy/browse/v1/item_summary/search?q=ipad&limit=1", auth: "app", marketplace: "EBAY_US" },
	// Post-Order v2 (IAF auth)
	{
		tag: "post-order",
		method: "POST",
		path: "/post-order/v2/cancellation/check_eligibility",
		body: { legacyOrderId: "00-00000-00000" },
		auth: "user-iaf",
	},
	{ tag: "post-order", path: "/post-order/v2/return/search?limit=1", auth: "user-iaf" },
	{ tag: "post-order", path: "/post-order/v2/inquiry/search?limit=1", auth: "user-iaf" },
	{ tag: "post-order", path: "/post-order/v2/casemanagement/search?limit=1", auth: "user-iaf" },
	{ tag: "post-order", path: "/post-order/v2/cancellation/search?limit=1", auth: "user-iaf" },
	// Sell Feed (Limited Release; expect 403). feed_type is required.
	{ tag: "feed", path: "/sell/feed/v1/inventory_task?feed_type=LMS_ACTIVE_INVENTORY_REPORT", auth: "user" },
	// Buy Feed (Limited Release; expect 403)
	{ tag: "buy-feed", path: "/buy/feed/v1_beta/item", auth: "app" },
	// Analytics (sell.analytics.readonly; needs re-consent if missing)
	{
		tag: "analytics",
		path: "/sell/analytics/v1/seller_standards_profile/PROGRAM_US/CURRENT",
		auth: "user",
	},
	{
		// `filter=marketplace_ids:{EBAY_US},date_range:[…]` is REQUIRED
		// (errorId 50005 without it) AND the date format is `yyyymmdd`
		// not ISO `yyyy-mm-dd` (errorId 50013 — wrapper now strips hyphens).
		tag: "analytics",
		path:
			"/sell/analytics/v1/traffic_report?dimension=DAY&metric=LISTING_IMPRESSION_TOTAL" +
			"&filter=marketplace_ids:%7BEBAY_US%7D,date_range:%5B20260401..20260408%5D",
		auth: "user",
		marketplace: "EBAY_US",
	},
];

async function pickApiKeyId(): Promise<string> {
	if (process.env.APIKEY_ID) return process.env.APIKEY_ID;
	// Order by `updatedAt DESC` so we always probe with the freshest
	// binding — re-consenting creates a new row in `user_ebay_oauth`,
	// not an update, when the api-key changes; without ordering,
	// PostgreSQL can hand back a stale row from a previous OAuth grant
	// that's missing newer scopes (verified live 2026-05-03 — first run
	// after re-consent silently picked the 6-scope binding instead of
	// the 13-scope one and reported false 403s).
	const rows = await db
		.select({ id: userEbayOauth.apiKeyId })
		.from(userEbayOauth)
		.orderBy(desc(userEbayOauth.updatedAt))
		.limit(1);
	if (!rows[0]) throw new Error("No api_key has an eBay OAuth binding. Run /v1/connect/ebay first.");
	return rows[0].id;
}

async function callOne(spec: ProbeSpec, userToken: string, appToken: string): Promise<ProbeResult> {
	const host = ebayHostFor(spec.path);
	const url = `${host}${spec.path}`;
	const headers: Record<string, string> = { Accept: "application/json", "Accept-Language": "en-US" };
	if (spec.auth === "user-iaf") headers.Authorization = `IAF ${userToken}`;
	else if (spec.auth === "user") headers.Authorization = `Bearer ${userToken}`;
	else headers.Authorization = `Bearer ${appToken}`;
	if (spec.marketplace) headers["X-EBAY-C-MARKETPLACE-ID"] = spec.marketplace;
	if (spec.body !== undefined) {
		headers["Content-Type"] = "application/json";
		headers["Content-Language"] = "en-US";
	}
	let res: Response;
	try {
		res = await fetch(url, {
			method: spec.method ?? "GET",
			headers,
			body: spec.body !== undefined ? JSON.stringify(spec.body) : undefined,
		});
	} catch (err) {
		return {
			tag: spec.tag,
			method: spec.method ?? "GET",
			path: spec.path,
			host,
			status: 0,
			message: err instanceof Error ? err.message : String(err),
		};
	}
	const text = await res.text();
	let parsed: unknown;
	try {
		parsed = text ? JSON.parse(text) : undefined;
	} catch {
		parsed = text.slice(0, 200);
	}
	const result: ProbeResult = {
		tag: spec.tag,
		method: spec.method ?? "GET",
		path: spec.path,
		host,
		status: res.status,
	};
	if (parsed && typeof parsed === "object") {
		const p = parsed as { errors?: Array<{ errorId?: number; message?: string; longMessage?: string }> };
		if (p.errors?.length) {
			result.errorId = p.errors[0]!.errorId;
			result.message = p.errors[0]!.longMessage ?? p.errors[0]!.message;
		}
		const keys = Object.keys(parsed as object).slice(0, 6);
		result.body = keys.length ? Object.fromEntries(keys.map((k) => [k, "<…>"])) : undefined;
	}
	return result;
}

async function main(): Promise<void> {
	const apiKeyId = await pickApiKeyId();
	console.error(`[probe] using apiKeyId=${apiKeyId}`);
	const userToken = await getUserAccessToken(apiKeyId);
	console.error(`[probe] user token len=${userToken.length}`);
	const appToken = await getAppAccessToken();
	const onlyTags = process.env.ONLY?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
	const filtered = onlyTags ? PROBES.filter((p) => onlyTags.includes(p.tag)) : PROBES;
	console.error(`[probe] running ${filtered.length} probes`);

	const results: ProbeResult[] = [];
	for (const spec of filtered) {
		const r = await callOne(spec, userToken, appToken);
		results.push(r);
		const tail = r.errorId ? ` errorId=${r.errorId}` : "";
		console.error(`  [${r.tag}] ${r.method} ${r.path} → ${r.status}${tail}`);
	}

	const outPath = "../../notes/ebay-endpoint-probe-results.json";
	writeFileSync(outPath, `${JSON.stringify({ probedAt: new Date().toISOString(), apiKeyId, results }, null, 2)}\n`);
	console.error(`[probe] wrote ${results.length} results to ${outPath}`);
	process.exit(0);
}

main().catch((err) => {
	console.error("[probe] fatal:", err);
	process.exit(1);
});
