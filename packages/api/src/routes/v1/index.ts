/**
 * Single mount point for the entire `/v1/*` surface — flipagent-native only.
 *
 * Phase 1 scope (what an agent needs to run a hands-off reseller cycle —
 * source / buy / receive / list / sell / communicate / refund / analyze):
 *
 *   - Source:        items, evaluate, categories, products
 *   - Buy:           purchases, bids
 *   - Receive:       forwarder
 *   - List:          listings, locations, policies, media
 *   - Sell:          sales, labels
 *   - Communicate:   messages, feedback, notifications, webhooks, offers
 *   - Resolve:       disputes
 *   - Analyze:       payouts, transactions, analytics, recommendations
 *   - Tax:           seller (sales-tax under /v1/me/seller)
 *   - Operational:   connect, me, keys, billing, health, capabilities, admin
 *   - Compliance:    takedown (DMCA / GDPR / CCPA / seller opt-out)
 *   - Plumbing:      bridge (extension wire protocol — required for purchases + forwarder)
 *
 * Surfaces with wrappers but disabled for V1 (left commented at the bottom):
 *   charities, featured, edelivery, violations, marketplaces (metadata),
 *   expenses, trends, promotions, markdowns, ads, store, feeds, translate,
 *   watching, developer, cart, listings/bulk, listing-groups.
 *
 * To re-enable: uncomment the import + mount line. Service-layer wrappers
 * stay intact under `services/*` so the call site is ready when needed.
 */

import { Hono } from "hono";
import { adminRoute } from "./admin.js";
import { agentRoute } from "./agent.js";
import { analyticsRoute } from "./analytics.js";
import { bidsRoute } from "./bids.js";
import { billingRoute } from "./billing.js";
import { bridgeRoute } from "./bridge.js";
import { browserRoute } from "./browser.js";
import { capabilitiesRoute } from "./capabilities.js";
import { categoriesRoute } from "./categories.js";
import { connectRoute } from "./connect.js";
import { disputesRoute } from "./disputes.js";
import { ebayNotificationsRoute } from "./ebay-notifications.js";
import { evaluateRoute } from "./evaluate.js";
import { feedbackRoute } from "./feedback.js";
import { forwarderRoute } from "./forwarder.js";
import { v1HealthRoute } from "./health.js";
import { itemsRoute } from "./items.js";
import { jobsRoute } from "./jobs.js";
import { keysRoute } from "./keys.js";
import { labelsRoute } from "./labels.js";
import { listingsRoute } from "./listings.js";
import { locationsRoute } from "./locations.js";
import { meRoute } from "./me.js";
import { meOverviewRoute } from "./me-overview.js";
import { mediaRoute } from "./media.js";
import { messagesRoute } from "./messages.js";
import { notificationsRoute } from "./notifications.js";
import { offersRoute } from "./offers.js";
import { payoutsRoute } from "./payouts.js";
import { policiesRoute } from "./policies.js";
import { productsRoute } from "./products.js";
import { purchasesRoute } from "./purchases.js";
import { recommendationsRoute } from "./recommendations.js";
import { salesRoute } from "./sales.js";
import { sellerRoute } from "./seller.js";
import { shipRoute } from "./ship.js";
import { takedownRoute } from "./takedown.js";
import { transactionsRoute } from "./transactions.js";
import { webhooksRoute } from "./webhooks.js";

export const v1Routes = new Hono();

// ---- Source ------------------------------------------------------------
v1Routes.route("/items", itemsRoute);
v1Routes.route("/categories", categoriesRoute);
v1Routes.route("/products", productsRoute);
v1Routes.route("/evaluate", evaluateRoute);
v1Routes.route("/jobs", jobsRoute);

// ---- Buy + Receive -----------------------------------------------------
v1Routes.route("/purchases", purchasesRoute);
v1Routes.route("/bids", bidsRoute);
v1Routes.route("/forwarder", forwarderRoute);

// ---- List --------------------------------------------------------------
v1Routes.route("/listings", listingsRoute);
v1Routes.route("/locations", locationsRoute);
v1Routes.route("/policies", policiesRoute);
v1Routes.route("/media", mediaRoute);

// ---- Sell --------------------------------------------------------------
v1Routes.route("/sales", salesRoute);
v1Routes.route("/labels", labelsRoute);
// `/ship/quote` adds zone calculation + packaging optimization on top of
// raw Sell Logistics rates (`services/quant/forwarder.ts`).
v1Routes.route("/ship", shipRoute);

// ---- Communicate -------------------------------------------------------
v1Routes.route("/messages", messagesRoute);
v1Routes.route("/feedback", feedbackRoute);
v1Routes.route("/notifications", notificationsRoute);
v1Routes.route("/webhooks", webhooksRoute);
v1Routes.route("/offers", offersRoute);

// ---- eBay-required compliance endpoints (path pinned by eBay portal) ---
// /v1/ebay/notifications/account-deletion is registered with eBay as the
// Marketplace Account Deletion handler — eBay marks the app down 24h
// after we stop 200-acking, and revokes keys at 30 days non-compliance.
v1Routes.route("/ebay/notifications", ebayNotificationsRoute);

// ---- Resolve -----------------------------------------------------------
v1Routes.route("/disputes", disputesRoute);

// ---- Analyze -----------------------------------------------------------
v1Routes.route("/payouts", payoutsRoute);
v1Routes.route("/transactions", transactionsRoute);
v1Routes.route("/analytics", analyticsRoute);
v1Routes.route("/recommendations", recommendationsRoute);

// ---- Account / ops -----------------------------------------------------
v1Routes.route("/connect", connectRoute);
// `/me/seller` carries sales-tax + payments-program + privilege; mounted
// before `/me` so the more specific path wins (Hono routes by mount order).
v1Routes.route("/me/seller", sellerRoute);
// `/me/{programs,selling,buying,quota}` — agent-facing reads (API key auth).
// `/programs/opt-in` is required before policy creation works, so this
// has to land before the dashboard `/me` catch-all below.
v1Routes.route("/me", meOverviewRoute);
// `/me` is one mount: the dashboard surface (session) plus `/me/selling`
// + `/me/buying` (API key + Trading XML, mounted inside `meRoute` ahead
// of `requireSession`). See `routes/v1/me.ts`.
v1Routes.route("/me", meRoute);
v1Routes.route("/keys", keysRoute);
v1Routes.route("/billing", billingRoute);
v1Routes.route("/health", v1HealthRoute);
v1Routes.route("/capabilities", capabilitiesRoute);
v1Routes.route("/admin", adminRoute);

// ---- ToS hygiene / regulatory compliance ------------------------------
// `/takedown` covers DMCA §512(c)(3) infringement notices, GDPR Art. 17
// erasure, CCPA §1798.105 deletion, and voluntary seller opt-out. Single
// pipe, three regulatory regimes. Counter-notice (§512(g)) hangs off the
// same router. Unauthenticated by design — requesters don't need a key.
v1Routes.route("/takedown", takedownRoute);

// ---- Agent (preview) ---------------------------------------------------
// `/agent/*` is the chat surface backed by OpenAI's Responses API.
// Stateful threads (server-side history via `previous_response_id`) +
// user-stated rules folded into instructions + an activity-feed log of
// every run. Tool use lands in a follow-up — for now it's a "talk to
// the LLM and feel the persistent thread" preview.
v1Routes.route("/agent", agentRoute);

// ---- Agent plumbing ----------------------------------------------------
// `/bridge/*` is the wire protocol the Chrome extension uses to talk to
// flipagent (token issuance + longpoll + result reporting). Required for
// `/purchases` (bridge transport) and `/forwarder/*`.
v1Routes.route("/bridge", bridgeRoute);
// `/browser/*` is the synchronous DOM-primitive escape hatch agents reach
// for when no eBay API exists for a step. Runs through the same Chrome
// extension as `/forwarder/*` and bridge purchases.
v1Routes.route("/browser", browserRoute);

// ---- Disabled for V1 (uncomment to re-enable) --------------------------
// import { adsRoute } from "./ads.js";
// import { cartRoute } from "./cart.js";
// import { charitiesRoute } from "./charities.js";
// import { developerRoute } from "./developer.js";
// import { edeliveryRoute } from "./edelivery.js";
// import { expensesRoute } from "./expenses.js";
// import { featuredRoute } from "./featured.js";
// import { feedsRoute } from "./feeds.js";
// import { listingGroupsRoute } from "./listing-groups.js";
// import { listingsBulkRoute } from "./listings-bulk.js";
// import { markdownsRoute } from "./markdowns.js";
// import { marketplacesRoute } from "./marketplaces.js";
// import { promotionsRoute } from "./promotions.js";
// import { storeRoute } from "./store.js";
// import { translateRoute } from "./translate.js";
// import { trendsRoute } from "./trends.js";
// import { violationsRoute } from "./violations.js";
// import { watchingRoute } from "./watching.js";
//
// v1Routes.route("/charities", charitiesRoute);
// v1Routes.route("/featured", featuredRoute);
// v1Routes.route("/listings/bulk", listingsBulkRoute);
// v1Routes.route("/listing-groups", listingGroupsRoute);
// v1Routes.route("/cart", cartRoute);
// v1Routes.route("/edelivery", edeliveryRoute);
// v1Routes.route("/violations", violationsRoute);
// v1Routes.route("/marketplaces", marketplacesRoute);
// v1Routes.route("/expenses", expensesRoute);
// v1Routes.route("/trends", trendsRoute);
// v1Routes.route("/promotions", promotionsRoute);
// v1Routes.route("/markdowns", markdownsRoute);
// v1Routes.route("/ads", adsRoute);
// v1Routes.route("/store", storeRoute);
// v1Routes.route("/feeds", feedsRoute);
// v1Routes.route("/translate", translateRoute);
// v1Routes.route("/watching", watchingRoute);
// v1Routes.route("/developer", developerRoute);
