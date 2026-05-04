/**
 * Broad path-existence sweep for every eBay GET path that any flipagent
 * wrapper references. Complements `ebay-endpoint-probe.ts` (which exercises
 * a curated set with valid request shapes) by firing fake-ID variants at
 * every read endpoint and classifying the response:
 *
 *   - 200/204                              → OK (path + auth + scope all correct)
 *   - 4xx/5xx WITH `errors[].errorId`      → reachable; eBay rejected the
 *                                            specific request payload (e.g. fake
 *                                            sku, wrong filter). Path correct.
 *   - 404 with EMPTY body                  → wrong host or path (apiz signature)
 *   - 403 errorId 1100                     → scope-or-LR gated (not a path bug)
 *
 * The signal the path is correctly wired = "got an `errors[]` envelope back."
 * Empty-body 404 is what tipped us off to the apiz host bug last sweep, so
 * this scan exists specifically to catch that class of mistake repo-wide.
 *
 * Run:
 *   cd packages/api && node --env-file=.env --import tsx scripts/ebay-path-sweep.ts
 *
 * Optional:
 *   APIKEY_ID=<uuid>   pin a specific binding (default: most recent)
 */

import { writeFileSync } from "node:fs";
import { desc } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { userEbayOauth } from "../src/db/schema.js";
import { ebayHostFor } from "../src/services/ebay/host.js";
import { getAppAccessToken, getUserAccessToken } from "../src/services/ebay/oauth.js";

interface SweepRow {
	path: string;
	auth: "user" | "user-iaf" | "app";
	host: string;
	status: number;
	errorId?: number;
	classification:
		| "OK"
		| "REACHABLE_4XX_WITH_ENVELOPE"
		| "WRONG_PATH_OR_HOST_EMPTY_404"
		| "SCOPE_OR_LR_1100"
		| "AUTH_401"
		| "RATE_LIMIT_429"
		| "SERVER_5XX"
		| "OTHER";
	note?: string;
}

interface PathSpec {
	path: string;
	auth: "user" | "user-iaf" | "app";
	marketplace?: string;
	method?: "GET";
}

/**
 * Curated set: every GET we wrap, with fake IDs substituted in for `{x}`
 * placeholders. Auth picked per resource (user vs user-iaf vs app).
 */
const PATHS: PathSpec[] = [
	// Buy / Browse — app credential
	{ path: "/buy/browse/v1/item/v1%7C0%7C0", auth: "app", marketplace: "EBAY_US" },
	{ path: "/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=000000000000", auth: "app", marketplace: "EBAY_US" },
	{ path: "/buy/browse/v1/item/get_items_by_item_group?item_group_id=000000000000", auth: "app", marketplace: "EBAY_US" },
	{ path: "/buy/browse/v1/item_summary/search?q=ipad&limit=1", auth: "app", marketplace: "EBAY_US" },
	// Buy / Marketplace Insights — Limited Release
	{ path: "/buy/marketplace_insights/v1_beta/item_sales/search?q=ipad&limit=1", auth: "app", marketplace: "EBAY_US" },
	// Buy / Deal
	{ path: "/buy/deal/v1/deal_item?limit=1", auth: "app", marketplace: "EBAY_US" },
	{ path: "/buy/deal/v1/event_item?limit=1", auth: "app", marketplace: "EBAY_US" },
	// Commerce / Catalog
	{ path: "/commerce/catalog/v1_beta/product_summary/search?q=ipad&limit=1", auth: "app", marketplace: "EBAY_US" },
	// Commerce / Charity (user OAuth)
	{ path: "/commerce/charity/v1/charity_org?q=red&limit=1", auth: "user", marketplace: "EBAY_US" },
	{ path: "/commerce/charity/v1/charity_org/302", auth: "user", marketplace: "EBAY_US" },
	// Commerce / Identity (apiz)
	{ path: "/commerce/identity/v1/user/", auth: "user", marketplace: "EBAY_US" },
	// Commerce / Taxonomy
	{ path: "/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_US", auth: "app" },
	{ path: "/commerce/taxonomy/v1/category_tree/0", auth: "app" },
	// Commerce / Feedback
	{
		path: "/commerce/feedback/v1/feedback?user_id=sprd-shop&feedback_type=FEEDBACK_RECEIVED&filter=role:SELLER&limit=1",
		auth: "user",
		marketplace: "EBAY_US",
	},
	{ path: "/commerce/feedback/v1/awaiting_feedback?limit=1", auth: "user", marketplace: "EBAY_US" },
	// Commerce / Message
	{ path: "/commerce/message/v1/conversation?limit=1", auth: "user" },
	// Commerce / Notification
	{ path: "/commerce/notification/v1/topic", auth: "user" },
	{ path: "/commerce/notification/v1/destination", auth: "user" },
	{ path: "/commerce/notification/v1/subscription", auth: "user" },
	{ path: "/commerce/notification/v1/config", auth: "user" },
	{ path: "/commerce/notification/v1/public_key/__no_such__", auth: "user" },
	// Sell / Account — every GET
	{ path: "/sell/account/v1/privilege", auth: "user" },
	{ path: "/sell/account/v1/kyc", auth: "user" },
	{ path: "/sell/account/v1/subscription", auth: "user" },
	{ path: "/sell/account/v1/rate_table", auth: "user" },
	{ path: "/sell/account/v1/custom_policy", auth: "user", marketplace: "EBAY_US" },
	{ path: "/sell/account/v1/sales_tax?country_code=US", auth: "user" },
	{ path: "/sell/account/v1/advertising_eligibility", auth: "user", marketplace: "EBAY_US" },
	{ path: "/sell/account/v1/payments_program/EBAY_US/EBAY_PAYMENTS", auth: "user" },
	{ path: "/sell/account/v1/payments_program/EBAY_US/EBAY_PAYMENTS/onboarding", auth: "user" },
	{ path: "/sell/account/v1/program/get_opted_in_programs", auth: "user" },
	{ path: "/sell/account/v1/return_policy?marketplace_id=EBAY_US", auth: "user" },
	{ path: "/sell/account/v1/payment_policy?marketplace_id=EBAY_US", auth: "user" },
	{ path: "/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_US", auth: "user" },
	{ path: "/sell/account/v1/return_policy/get_by_policy_name?marketplace_id=EBAY_US&name=__none__", auth: "user" },
	{ path: "/sell/account/v1/payment_policy/get_by_policy_name?marketplace_id=EBAY_US&name=__none__", auth: "user" },
	{ path: "/sell/account/v1/fulfillment_policy/get_by_policy_name?marketplace_id=EBAY_US&name=__none__", auth: "user" },
	// Sell / Stores
	{ path: "/sell/stores/v1/store", auth: "user", marketplace: "EBAY_US" },
	{ path: "/sell/stores/v2/store-categories", auth: "user", marketplace: "EBAY_US" },
	// Sell / Inventory
	{ path: "/sell/inventory/v1/inventory_item?limit=1", auth: "user" },
	{ path: "/sell/inventory/v1/inventory_item/__no_sku__", auth: "user" },
	{ path: "/sell/inventory/v1/inventory_item/__no_sku__/product_compatibility", auth: "user" },
	{ path: "/sell/inventory/v1/inventory_item_group/__no_group__", auth: "user" },
	{ path: "/sell/inventory/v1/location?limit=1", auth: "user" },
	{ path: "/sell/inventory/v1/location/__no_loc__", auth: "user" },
	{ path: "/sell/inventory/v1/offer?sku=__no_sku__", auth: "user", marketplace: "EBAY_US" },
	{ path: "/sell/inventory/v1/offer/__no_offer__", auth: "user", marketplace: "EBAY_US" },
	{
		path: "/sell/inventory/v1/listing/__no_id__/sku/__no_sku__/locations",
		auth: "user",
		marketplace: "EBAY_US",
	},
	// Sell / Fulfillment
	{ path: "/sell/fulfillment/v1/order?limit=1", auth: "user" },
	{ path: "/sell/fulfillment/v1/order/__no_order__", auth: "user" },
	{ path: "/sell/fulfillment/v1/order/__no_order__/shipping_fulfillment", auth: "user" },
	// payment_dispute (apiz)
	{ path: "/sell/fulfillment/v1/payment_dispute/__no_dispute__", auth: "user" },
	{ path: "/sell/fulfillment/v1/payment_dispute_summary?look_back_days=30", auth: "user" },
	// Sell / Marketing
	{ path: "/sell/marketing/v1/ad_campaign?limit=1", auth: "user", marketplace: "EBAY_US" },
	{ path: "/sell/marketing/v1/ad_campaign/__no_camp__", auth: "user", marketplace: "EBAY_US" },
	{ path: "/sell/marketing/v1/ad_campaign/__no_camp__/ad", auth: "user", marketplace: "EBAY_US" },
	{ path: "/sell/marketing/v1/ad_campaign/__no_camp__/ad_group", auth: "user", marketplace: "EBAY_US" },
	{ path: "/sell/marketing/v1/ad_campaign/get_campaign_by_name?name=__none__", auth: "user", marketplace: "EBAY_US" },
	{ path: "/sell/marketing/v1/ad_report_metadata", auth: "user", marketplace: "EBAY_US" },
	{ path: "/sell/marketing/v1/ad_report_task?limit=1", auth: "user", marketplace: "EBAY_US" },
	{ path: "/sell/marketing/v1/promotion?marketplace_id=EBAY_US&limit=1", auth: "user" },
	{
		path: "/sell/marketing/v1/promotion?marketplace_id=EBAY_US&promotion_type=MARKDOWN_SALE&limit=1",
		auth: "user",
	},
	{ path: "/sell/marketing/v1/promotion_summary_report?marketplace_id=EBAY_US", auth: "user" },
	// Sell / Compliance
	{ path: "/sell/compliance/v1/listing_violation_summary", auth: "user", marketplace: "EBAY_US" },
	{ path: "/sell/compliance/v1/listing_violation?compliance_type=PRODUCT_ADOPTION&limit=1", auth: "user", marketplace: "EBAY_US" },
	// Sell / Metadata
	{ path: "/sell/metadata/v1/marketplace/EBAY_US/get_return_policies", auth: "user" },
	{ path: "/sell/metadata/v1/marketplace/EBAY_US/get_listing_structure_policies", auth: "user" },
	{ path: "/sell/metadata/v1/marketplace/EBAY_US/get_currencies", auth: "user" },
	{ path: "/sell/metadata/v1/marketplace/EBAY_US/get_extended_producer_responsibility_policies", auth: "user" },
	{ path: "/sell/metadata/v1/marketplace/EBAY_US/get_hazardous_materials_labels", auth: "user" },
	{ path: "/sell/metadata/v1/marketplace/EBAY_US/get_motors_listing_policies?filter=categoryIds:%7B33707%7D", auth: "user" },
	{ path: "/sell/metadata/v1/marketplace/EBAY_US/get_negotiated_price_policies", auth: "user" },
	{ path: "/sell/metadata/v1/marketplace/EBAY_US/get_payment_policies", auth: "user" },
	{ path: "/sell/metadata/v1/marketplace/EBAY_US/get_product_adoption_policies", auth: "user" },
	{ path: "/sell/metadata/v1/marketplace/EBAY_US/get_return_policies", auth: "user" },
	{ path: "/sell/metadata/v1/country/US/sales_tax_jurisdiction", auth: "user" },
	// Sell / Negotiation
	{ path: "/sell/negotiation/v1/find_eligible_items", auth: "user", marketplace: "EBAY_US" },
	// Sell / Recommendation (POST is the only verb; GET would 405)
	// Sell / Finances (apiz)
	{ path: "/sell/finances/v1/payout?limit=1", auth: "user" },
	{ path: "/sell/finances/v1/payout/__no_payout__", auth: "user" },
	{ path: "/sell/finances/v1/payout_summary", auth: "user" },
	{ path: "/sell/finances/v1/transaction?limit=1", auth: "user" },
	{ path: "/sell/finances/v1/transaction_summary", auth: "user" },
	{ path: "/sell/finances/v1/transfer?limit=1", auth: "user" },
	{ path: "/sell/finances/v1/transfer/__no_transfer__", auth: "user" },
	// Sell / Logistics (Limited Release)
	{ path: "/sell/logistics/v1_beta/shipment/__no_shipment__", auth: "user" },
	// Sell / Analytics
	{ path: "/sell/analytics/v1/seller_standards_profile/PROGRAM_US/CURRENT", auth: "user" },
	{ path: "/sell/analytics/v1/customer_service_metric/ITEM_NOT_AS_DESCRIBED/CURRENT", auth: "user", marketplace: "EBAY_US" },
	{
		path:
			"/sell/analytics/v1/traffic_report?dimension=DAY&metric=LISTING_IMPRESSION_TOTAL" +
			"&filter=marketplace_ids:%7BEBAY_US%7D,date_range:%5B20260401..20260408%5D",
		auth: "user",
		marketplace: "EBAY_US",
	},
	// Sell / Feed (Limited Release)
	{ path: "/sell/feed/v1/inventory_task?feed_type=LMS_ACTIVE_INVENTORY_REPORT&limit=1", auth: "user" },
	{ path: "/sell/feed/v1/order_task?limit=1", auth: "user" },
	{ path: "/sell/feed/v1/customer_service_metric_task?limit=1", auth: "user" },
	// Buy / Order (Limited Release). Path version is `v1`, not `v2`
	// (verified live 2026-05-03 — `v2` 404s with envelope, `v1` 404s
	// with envelope on apiz host). Hosted on apiz per ebay/host.ts.
	{ path: "/buy/order/v1/checkout_session/__no_session__", auth: "user", marketplace: "EBAY_US" },
	// Buy / Offer (Limited Release in production)
	{ path: "/buy/offer/v1_beta/bidding/v123", auth: "user", marketplace: "EBAY_US" },
	// Buy / Feed (Limited Release)
	{ path: "/buy/feed/v1_beta/item?feed_scope=NEWLY_LISTED&category_id=11116&date=20260101", auth: "app" },
	// Post-Order v2 (IAF)
	{ path: "/post-order/v2/return/search?limit=1", auth: "user-iaf" },
	{ path: "/post-order/v2/inquiry/search?limit=1", auth: "user-iaf" },
	{ path: "/post-order/v2/casemanagement/search?limit=1", auth: "user-iaf" },
	{ path: "/post-order/v2/cancellation/search?limit=1", auth: "user-iaf" },
	{ path: "/post-order/v2/return/__no_return__", auth: "user-iaf" },
	{ path: "/post-order/v2/inquiry/__no_inquiry__", auth: "user-iaf" },
	{ path: "/post-order/v2/cancellation/__no_cancel__", auth: "user-iaf" },
];

async function pickApiKeyId(): Promise<string> {
	if (process.env.APIKEY_ID) return process.env.APIKEY_ID;
	const rows = await db
		.select({ id: userEbayOauth.apiKeyId })
		.from(userEbayOauth)
		.orderBy(desc(userEbayOauth.updatedAt))
		.limit(1);
	if (!rows[0]) throw new Error("No userEbayOauth binding. Run /v1/connect/ebay first.");
	return rows[0].id;
}

function classify(status: number, errorId: number | undefined, bodyText: string): SweepRow["classification"] {
	if (status >= 200 && status < 300) return "OK";
	if (status === 401) return "AUTH_401";
	if (status === 429) return "RATE_LIMIT_429";
	if (status === 403 && errorId === 1100) return "SCOPE_OR_LR_1100";
	if (status >= 500) return "SERVER_5XX";
	if (status === 404 && bodyText.length === 0) return "WRONG_PATH_OR_HOST_EMPTY_404";
	if (errorId !== undefined) return "REACHABLE_4XX_WITH_ENVELOPE";
	return "OTHER";
}

async function callOne(spec: PathSpec, userToken: string, appToken: string): Promise<SweepRow> {
	const host = ebayHostFor(spec.path);
	const headers: Record<string, string> = { Accept: "application/json", "Accept-Language": "en-US" };
	if (spec.auth === "user-iaf") headers.Authorization = `IAF ${userToken}`;
	else if (spec.auth === "user") headers.Authorization = `Bearer ${userToken}`;
	else headers.Authorization = `Bearer ${appToken}`;
	if (spec.marketplace) headers["X-EBAY-C-MARKETPLACE-ID"] = spec.marketplace;
	let res: Response;
	try {
		res = await fetch(`${host}${spec.path}`, { method: spec.method ?? "GET", headers });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { path: spec.path, auth: spec.auth, host, status: 0, classification: "OTHER", note: msg };
	}
	const text = await res.text();
	let parsed: unknown;
	try {
		parsed = text ? JSON.parse(text) : undefined;
	} catch {
		parsed = undefined;
	}
	let errorId: number | undefined;
	let note: string | undefined;
	if (parsed && typeof parsed === "object") {
		const errs = (parsed as { errors?: Array<{ errorId?: number; longMessage?: string; message?: string }> }).errors;
		if (errs?.length) {
			errorId = errs[0]!.errorId;
			note = errs[0]!.longMessage ?? errs[0]!.message;
		}
	}
	return {
		path: spec.path,
		auth: spec.auth,
		host,
		status: res.status,
		errorId,
		classification: classify(res.status, errorId, text),
		note,
	};
}

async function main(): Promise<void> {
	const apiKeyId = await pickApiKeyId();
	console.error(`[sweep] apiKeyId=${apiKeyId}`);
	const userToken = await getUserAccessToken(apiKeyId);
	const appToken = await getAppAccessToken();
	const out: SweepRow[] = [];
	for (const spec of PATHS) {
		const r = await callOne(spec, userToken, appToken);
		out.push(r);
		const tag = r.classification.padEnd(34);
		const eid = r.errorId !== undefined ? ` errorId=${r.errorId}` : "";
		console.error(`  [${r.status}] ${tag} ${r.path}${eid}`);
	}
	const buckets: Record<SweepRow["classification"], number> = {
		OK: 0,
		REACHABLE_4XX_WITH_ENVELOPE: 0,
		WRONG_PATH_OR_HOST_EMPTY_404: 0,
		SCOPE_OR_LR_1100: 0,
		AUTH_401: 0,
		RATE_LIMIT_429: 0,
		SERVER_5XX: 0,
		OTHER: 0,
	};
	for (const r of out) buckets[r.classification]++;
	console.error("\n=== summary ===");
	for (const [k, v] of Object.entries(buckets)) console.error(`  ${k}: ${v}`);
	console.error(`  total: ${out.length}`);
	writeFileSync(
		"../../notes/ebay-path-sweep-results.json",
		`${JSON.stringify({ probedAt: new Date().toISOString(), apiKeyId, results: out, buckets }, null, 2)}\n`,
	);
	console.error("[sweep] wrote ../../notes/ebay-path-sweep-results.json");
	process.exit(0);
}

main().catch((err) => {
	console.error("[sweep] fatal:", err);
	process.exit(1);
});
