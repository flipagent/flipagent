/**
 * Single mount point for the entire `/v1/*` surface — flipagent-native only.
 *
 *   1. Marketplace data (read): items, categories, products, charities,
 *      media, featured
 *   2. My side (write): listings, listing-groups, listings/bulk, locations,
 *      purchases, sales
 *   3. Money + comms + disputes: payouts, transactions, transfers,
 *      messages, offers, feedback, disputes, policies, violations,
 *      recommendations, marketplaces, me/seller
 *   4. Intelligence: evaluate, ship, expenses, trends
 *   5. Marketing & store: promotions, ads, store, analytics, feeds, bids,
 *      markdowns, translate, labels
 *   6. Buyer + seller "my eBay" surfaces: me/{selling,buying}, watching,
 *      saved-searches
 *   7. Account, ops, plumbing: connect, me, keys, billing, health,
 *      capabilities, takedown, admin, forwarder, bridge, browser,
 *      notifications, webhooks
 *
 * Internally these still call eBay's REST + scrape + bridge + Trading
 * providers under `services/ebay/*`; the public surface itself is
 * marketplace-agnostic. No mirror, no aliases, no raw passthrough.
 */

import { Hono } from "hono";
import { adminRoute } from "./admin.js";
import { adsRoute } from "./ads.js";
import { analyticsRoute } from "./analytics.js";
import { bidsRoute } from "./bids.js";
import { billingRoute } from "./billing.js";
import { bridgeRoute } from "./bridge.js";
import { browserRoute } from "./browser.js";
import { capabilitiesRoute } from "./capabilities.js";
import { categoriesRoute } from "./categories.js";
import { charitiesRoute } from "./charities.js";
import { connectRoute } from "./connect.js";
import { disputesRoute } from "./disputes.js";
import { evaluateRoute } from "./evaluate.js";
import { expensesRoute } from "./expenses.js";
import { featuredRoute } from "./featured.js";
import { feedbackRoute } from "./feedback.js";
import { feedsRoute } from "./feeds.js";
import { forwarderRoute } from "./forwarder.js";
import { v1HealthRoute } from "./health.js";
import { itemsRoute } from "./items.js";
import { keysRoute } from "./keys.js";
import { labelsRoute } from "./labels.js";
import { listingGroupsRoute } from "./listing-groups.js";
import { listingsRoute } from "./listings.js";
import { listingsBulkRoute } from "./listings-bulk.js";
import { locationsRoute } from "./locations.js";
import { markdownsRoute } from "./markdowns.js";
import { marketplacesRoute } from "./marketplaces.js";
import { meRoute } from "./me.js";
import { mediaRoute } from "./media.js";
import { messagesRoute } from "./messages.js";
import { notificationsRoute } from "./notifications.js";
import { offersRoute } from "./offers.js";
import { payoutsRoute } from "./payouts.js";
import { policiesRoute } from "./policies.js";
import { productsRoute } from "./products.js";
import { promotionsRoute } from "./promotions.js";
import { purchasesRoute } from "./purchases.js";
import { recommendationsRoute } from "./recommendations.js";
import { salesRoute } from "./sales.js";
import { savedSearchesRoute } from "./saved-searches.js";
import { sellerRoute } from "./seller.js";
import { shipRoute } from "./ship.js";
import { storeRoute } from "./store.js";
import { takedownRoute } from "./takedown.js";
import { transactionsRoute } from "./transactions.js";
import { transfersRoute } from "./transfers.js";
import { translateRoute } from "./translate.js";
import { trendsRoute } from "./trends.js";
import { violationsRoute } from "./violations.js";
import { watchingRoute } from "./watching.js";
import { webhooksRoute } from "./webhooks.js";

export const v1Routes = new Hono();

// ---- Marketplace data (read) -------------------------------------------
v1Routes.route("/items", itemsRoute);
v1Routes.route("/categories", categoriesRoute);
v1Routes.route("/products", productsRoute);
v1Routes.route("/charities", charitiesRoute);
v1Routes.route("/media", mediaRoute);
v1Routes.route("/featured", featuredRoute);

// ---- My side (write) ---------------------------------------------------
v1Routes.route("/listings/bulk", listingsBulkRoute);
v1Routes.route("/listings", listingsRoute);
v1Routes.route("/listing-groups", listingGroupsRoute);
v1Routes.route("/locations", locationsRoute);
v1Routes.route("/purchases", purchasesRoute);
v1Routes.route("/sales", salesRoute);

// ---- Money + comms + disputes ------------------------------------------
v1Routes.route("/payouts", payoutsRoute);
v1Routes.route("/transactions", transactionsRoute);
v1Routes.route("/transfers", transfersRoute);
v1Routes.route("/messages", messagesRoute);
v1Routes.route("/offers", offersRoute);
v1Routes.route("/feedback", feedbackRoute);
v1Routes.route("/disputes", disputesRoute);
v1Routes.route("/policies", policiesRoute);
v1Routes.route("/violations", violationsRoute);
v1Routes.route("/recommendations", recommendationsRoute);
v1Routes.route("/marketplaces", marketplacesRoute);

// ---- Intelligence ------------------------------------------------------
v1Routes.route("/evaluate", evaluateRoute);
v1Routes.route("/ship", shipRoute);
v1Routes.route("/expenses", expensesRoute);
v1Routes.route("/trends", trendsRoute);

// ---- Marketing + storefront + analytics + bulk + auction ---------------
v1Routes.route("/promotions", promotionsRoute);
v1Routes.route("/markdowns", markdownsRoute);
v1Routes.route("/ads", adsRoute);
v1Routes.route("/store", storeRoute);
v1Routes.route("/analytics", analyticsRoute);
v1Routes.route("/feeds", feedsRoute);
v1Routes.route("/bids", bidsRoute);
v1Routes.route("/translate", translateRoute);
v1Routes.route("/labels", labelsRoute);

// ---- Buyer + seller "my eBay" surfaces --------------------------------
v1Routes.route("/me/seller", sellerRoute);
v1Routes.route("/watching", watchingRoute);
v1Routes.route("/saved-searches", savedSearchesRoute);

// ---- Account / ops -----------------------------------------------------
v1Routes.route("/forwarder", forwarderRoute);
v1Routes.route("/connect", connectRoute);
// `/me` is one mount: the dashboard surface (session) plus `/me/selling`
// + `/me/buying` (API key + Trading XML, mounted inside `meRoute` ahead
// of `requireSession`). See `routes/v1/me.ts`.
v1Routes.route("/me", meRoute);
v1Routes.route("/keys", keysRoute);
v1Routes.route("/billing", billingRoute);
v1Routes.route("/health", v1HealthRoute);
v1Routes.route("/capabilities", capabilitiesRoute);
v1Routes.route("/takedown", takedownRoute);
v1Routes.route("/admin", adminRoute);

// ---- Agent plumbing ----------------------------------------------------
v1Routes.route("/bridge", bridgeRoute);
v1Routes.route("/browser", browserRoute);
v1Routes.route("/notifications", notificationsRoute);
v1Routes.route("/webhooks", webhooksRoute);
