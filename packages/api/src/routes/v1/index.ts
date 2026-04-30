/**
 * Single mount point for the entire `/v1/*` surface.
 *
 * Three layers, all under `/v1/*`:
 *
 *   1. eBay mirror (passthrough + cache-first where applicable):
 *      `/v1/buy/*`, `/v1/sell/*`, `/v1/commerce/*`, `/v1/post-order/*`.
 *      Path structure mirrors eBay's REST verbatim — agents can read
 *      eBay docs and call our routes one-to-one. Internally the
 *      passthrough rewrites our `/v1/<group>/<resource>/...` to eBay's
 *      `/sell/<resource>/v1/...` etc.
 *
 *   2. Trading XML wrappers (eBay has no REST equivalent):
 *      `/v1/messages`, `/v1/best-offer`, `/v1/feedback`. JSON-shaped
 *      flipagent surface over Trading API XML.
 *
 *   3. flipagent native — intelligence, ops, account:
 *      `/v1/{evaluate,discover,ship,expenses,trends}` (intelligence),
 *      `/v1/forwarder/{provider}/*` (forwarder ops),
 *      `/v1/{connect,me,keys,billing,health,capabilities,takedown}`
 *      (account/ops),
 *      `/v1/{bridge,browser,notifications,webhooks}` (agent plumbing).
 *
 * The buy-side queue lives behind `/v1/buy/order/*` (REST + bridge
 * transports under one surface) — there is no separate `/v1/orders/*`
 * mount.
 */

import { Hono } from "hono";
import { requireApiKey } from "../../middleware/auth.js";
import {
	ebayBuyDealRoute,
	ebayBuyFeedRoute,
	ebayBuyOfferRoute,
	ebayCommerceCatalogRoute,
	ebayCommerceIdentityRoute,
	ebayCommerceTranslationRoute,
	ebaySellAnalyticsRoute,
	ebaySellComplianceRoute,
	ebaySellFeedRoute,
	ebaySellLogisticsRoute,
	ebaySellMetadataRoute,
	ebaySellRecommendationRoute,
	ebaySellStoresRoute,
} from "./_passthroughs.js";
import { adminRoute } from "./admin.js";
import { bestOfferRoute } from "./best-offer.js";
import { billingRoute } from "./billing.js";
import { bridgeRoute } from "./bridge.js";
import { browserRoute } from "./browser.js";
import { ebayItemBatchRoute } from "./buy/browse-batch.js";
import { ebayItemDetailRoute } from "./buy/browse-item.js";
import { ebaySearchRoute } from "./buy/browse-search.js";
import { ebaySoldSearchRoute } from "./buy/marketplace-insights.js";
import { ebayOrderRoute } from "./buy/order.js";
import { ebayOrderV2Route } from "./buy/order-guest.js";
import { capabilitiesRoute } from "./capabilities.js";
import { ebayCommerceCatalogProductRoute } from "./commerce/catalog.js";
import { ebayCommerceTaxonomyRoute } from "./commerce/taxonomy.js";
import { connectRoute } from "./connect.js";
import { discoverRoute } from "./discover.js";
import { evaluateRoute } from "./evaluate.js";
import { expensesRoute } from "./expenses.js";
import { feedbackRoute } from "./feedback.js";
import { forwarderRoute } from "./forwarder.js";
import { v1HealthRoute } from "./health.js";
import { keysRoute } from "./keys.js";
import { meRoute } from "./me.js";
import { messagesRoute } from "./messages.js";
import { notificationsRoute } from "./notifications.js";
import { ebayPostOrderRoute } from "./post-order.js";
import { searchRoute } from "./search.js";
import { ebaySellAccountRoute } from "./sell/account.js";
import { ebaySellFinancesRoute } from "./sell/finances.js";
import { ebaySellFulfillmentRoute } from "./sell/fulfillment.js";
import { ebaySellInventoryRoute } from "./sell/inventory.js";
import { ebaySellMarketingRoute } from "./sell/marketing.js";
import { ebaySellNegotiationRoute } from "./sell/negotiation.js";
import { shipRoute } from "./ship.js";
import { takedownRoute } from "./takedown.js";
import { trendsRoute } from "./trends.js";
import { webhooksRoute } from "./webhooks.js";

export const v1Routes = new Hono();

// ---- eBay mirror — Buy ---------------------------------------------------
v1Routes.use("/buy/*", requireApiKey);
v1Routes.route("/buy/browse/item_summary/search", ebaySearchRoute);
v1Routes.route("/buy/browse/item", ebayItemBatchRoute); // mounts /get_items, /get_items_by_item_group
v1Routes.route("/buy/browse/item", ebayItemDetailRoute); // mounts /:itemId
v1Routes.route("/buy/marketplace_insights/item_sales/search", ebaySoldSearchRoute);
v1Routes.route("/buy/order", ebayOrderRoute);
v1Routes.route("/buy/order", ebayOrderV2Route);
v1Routes.route("/buy/feed", ebayBuyFeedRoute);
v1Routes.route("/buy/deal", ebayBuyDealRoute);
v1Routes.route("/buy/offer", ebayBuyOfferRoute);

// ---- eBay mirror — Sell --------------------------------------------------
v1Routes.use("/sell/*", requireApiKey);
v1Routes.route("/sell/inventory", ebaySellInventoryRoute);
v1Routes.route("/sell/fulfillment", ebaySellFulfillmentRoute);
v1Routes.route("/sell/finances", ebaySellFinancesRoute);
v1Routes.route("/sell/account", ebaySellAccountRoute);
v1Routes.route("/sell/marketing", ebaySellMarketingRoute);
v1Routes.route("/sell/negotiation", ebaySellNegotiationRoute);
v1Routes.route("/sell/analytics", ebaySellAnalyticsRoute);
v1Routes.route("/sell/compliance", ebaySellComplianceRoute);
v1Routes.route("/sell/recommendation", ebaySellRecommendationRoute);
v1Routes.route("/sell/logistics", ebaySellLogisticsRoute);
v1Routes.route("/sell/stores", ebaySellStoresRoute);
v1Routes.route("/sell/feed", ebaySellFeedRoute);
v1Routes.route("/sell/metadata", ebaySellMetadataRoute);

// ---- eBay mirror — Commerce ---------------------------------------------
v1Routes.use("/commerce/*", requireApiKey);
v1Routes.route("/commerce/taxonomy", ebayCommerceTaxonomyRoute);
// Typed /product/:epid (transport-aware: REST when approved, scrape
// otherwise). Mounted before the catch-all passthrough so the typed
// route wins for that path; all other /commerce/catalog/* paths
// (notably /product_summary/search) still flow through the passthrough.
v1Routes.route("/commerce/catalog", ebayCommerceCatalogProductRoute);
v1Routes.route("/commerce/catalog", ebayCommerceCatalogRoute);
v1Routes.route("/commerce/identity", ebayCommerceIdentityRoute);
v1Routes.route("/commerce/translation", ebayCommerceTranslationRoute);

// ---- eBay mirror — Post-order -------------------------------------------
v1Routes.use("/post-order/*", requireApiKey);
v1Routes.route("/post-order", ebayPostOrderRoute);

// ---- Trading XML wrappers (no REST equivalent on eBay) ------------------
v1Routes.route("/messages", messagesRoute);
v1Routes.route("/best-offer", bestOfferRoute);
v1Routes.route("/feedback", feedbackRoute);

// ---- flipagent intelligence ---------------------------------------------
v1Routes.route("/search", searchRoute);
v1Routes.route("/evaluate", evaluateRoute);
v1Routes.route("/discover", discoverRoute);
v1Routes.route("/ship", shipRoute);
v1Routes.route("/expenses", expensesRoute);
v1Routes.route("/trends", trendsRoute);

// ---- Forwarder ops (provider-namespaced; used in both buy + sell) -------
v1Routes.route("/forwarder", forwarderRoute);

// ---- Account / ops ------------------------------------------------------
v1Routes.route("/connect", connectRoute);
v1Routes.route("/me", meRoute);
v1Routes.route("/keys", keysRoute);
v1Routes.route("/billing", billingRoute);
v1Routes.route("/health", v1HealthRoute);
v1Routes.route("/capabilities", capabilitiesRoute);
v1Routes.route("/takedown", takedownRoute);
v1Routes.route("/admin", adminRoute);

// ---- Agent plumbing -----------------------------------------------------
v1Routes.route("/bridge", bridgeRoute);
v1Routes.route("/browser", browserRoute);
v1Routes.route("/notifications", notificationsRoute);
v1Routes.route("/webhooks", webhooksRoute);
