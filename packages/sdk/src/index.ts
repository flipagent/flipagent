/**
 * Typed client for the flipagent API — `api.flipagent.dev`.
 *
 * One client, one API key. Every namespace maps one-to-one to a
 * `/v1/<resource>` route. Phase 1 scope — what an agent needs to run a
 * hands-off reseller cycle (source → buy → receive → list → sell →
 * communicate → resolve → analyze).
 *
 *   Source:        items, categories, products, evaluate
 *   Buy + Receive: purchases, bids, forwarder
 *   List:          listings, locations, policies, media
 *   Sell:          sales, labels, ship
 *   Communicate:   messages, feedback, notifications, webhooks, offers
 *   Resolve:       disputes
 *   Analyze:       payouts, transactions, analytics, recommendations
 *   Operational:   me, seller, keys, billing, connect, capabilities, browser
 *
 *   Escape hatch:  http — typed get/post/put/patch/delete for endpoints
 *                  not yet wrapped (or surfaces deferred from Phase 1).
 *
 * Surfaces deferred from Phase 1 (wrappers exist on the API; not surfaced
 * on the client): ads, cart, charities, developer, edelivery, expenses,
 * featured, feeds, listing-groups, listings-bulk, markdowns, marketplaces,
 * promotions, store, takedown, translate, trends,
 * violations, watching. Reach them through `client.http` until promoted.
 */

import { type AgentClient, createAgentClient } from "./agent.js";
import { type AnalyticsClient, createAnalyticsClient } from "./analytics.js";
import { type BidsClient, createBidsClient } from "./bids.js";
import { type BillingClient, createBillingClient } from "./billing.js";
import { type BrowserClient, createBrowserClient } from "./browser.js";
import { type CapabilitiesClient, createCapabilitiesClient } from "./capabilities.js";
import { type CategoriesClient, createCategoriesClient } from "./categories.js";
import { type ConnectClient, createConnectClient } from "./connect.js";
import { createDisputesClient, type DisputesClient } from "./disputes.js";
import { createEvaluateClient, type EvaluateClient } from "./evaluate.js";
import { createFeedbackClient, type FeedbackClient } from "./feedback.js";
import { createForwarderClient, type ForwarderClient } from "./forwarder.js";
import { createHttp, type FlipagentHttp } from "./http.js";
import { createItemsClient, type ItemsClient } from "./items.js";
import { createJobsClient, type JobsClient } from "./jobs.js";
import { createKeysClient, type KeysClient } from "./keys.js";
import { createLabelsClient, type LabelsClient } from "./labels.js";
import { createListingsClient, type ListingsClient } from "./listings.js";
import { createLocationsClient, type LocationsClient } from "./locations.js";
import { createMeClient, type MeClient } from "./me.js";
import { createMediaClient, type MediaClient } from "./media.js";
import { createMessagesClient, type MessagesClient } from "./messages.js";
import { createPayoutsClient, createTransactionsClient, type PayoutsClient, type TransactionsClient } from "./money.js";
import { createNotificationsClient, type NotificationsClient } from "./notifications.js";
import { createOffersClient, type OffersClient } from "./offers.js";
import { createPoliciesClient, type PoliciesClient } from "./policies.js";
import { createProductsClient, type ProductsClient } from "./products.js";
import { createPurchasesClient, type PurchasesClient } from "./purchases.js";
import { createRecommendationsClient, type RecommendationsClient } from "./recommendations.js";
import { createSalesClient, type SalesClient } from "./sales.js";
import { createSellerClient, type SellerClient } from "./seller.js";
import { createShipClient, type ShipClient } from "./ship.js";
import { createWebhooksClient, type WebhooksClient } from "./webhooks.js";

export interface FlipagentClientOptions {
	apiKey: string;
	baseUrl?: string;
	fetch?: typeof globalThis.fetch;
}

export interface FlipagentClient {
	// Source
	items: ItemsClient;
	categories: CategoriesClient;
	products: ProductsClient;
	evaluate: EvaluateClient;

	// Buy + Receive
	purchases: PurchasesClient;
	bids: BidsClient;
	forwarder: ForwarderClient;

	// List
	listings: ListingsClient;
	locations: LocationsClient;
	policies: PoliciesClient;
	media: MediaClient;

	// Sell
	sales: SalesClient;
	labels: LabelsClient;
	ship: ShipClient;

	// Communicate
	messages: MessagesClient;
	feedback: FeedbackClient;
	notifications: NotificationsClient;
	webhooks: WebhooksClient;
	offers: OffersClient;

	// Resolve
	disputes: DisputesClient;

	// Analyze
	payouts: PayoutsClient;
	transactions: TransactionsClient;
	analytics: AnalyticsClient;
	recommendations: RecommendationsClient;

	// Operational
	me: MeClient;
	seller: SellerClient;
	keys: KeysClient;
	billing: BillingClient;
	connect: ConnectClient;
	capabilities: CapabilitiesClient;
	browser: BrowserClient;

	// Agent (preview)
	agent: AgentClient;

	// Cross-surface activity history (any kind, any surface).
	jobs: JobsClient;

	// Escape hatch
	http: FlipagentHttp;
}

const DEFAULT_BASE_URL = "https://api.flipagent.dev";

export function createFlipagentClient(opts: FlipagentClientOptions): FlipagentClient {
	const http = createHttp({
		apiKey: opts.apiKey,
		baseUrl: opts.baseUrl ?? DEFAULT_BASE_URL,
		fetch: opts.fetch,
	});
	return {
		items: createItemsClient(http),
		categories: createCategoriesClient(http),
		products: createProductsClient(http),
		evaluate: createEvaluateClient(http),

		purchases: createPurchasesClient(http),
		bids: createBidsClient(http),
		forwarder: createForwarderClient(http),

		listings: createListingsClient(http),
		locations: createLocationsClient(http),
		policies: createPoliciesClient(http),
		media: createMediaClient(http),

		sales: createSalesClient(http),
		labels: createLabelsClient(http),
		ship: createShipClient(http),

		messages: createMessagesClient(http),
		feedback: createFeedbackClient(http),
		notifications: createNotificationsClient(http),
		webhooks: createWebhooksClient(http),
		offers: createOffersClient(http),

		disputes: createDisputesClient(http),

		payouts: createPayoutsClient(http),
		transactions: createTransactionsClient(http),
		analytics: createAnalyticsClient(http),
		recommendations: createRecommendationsClient(http),

		me: createMeClient(http),
		seller: createSellerClient(http),
		keys: createKeysClient(http),
		billing: createBillingClient(http),
		connect: createConnectClient(http),
		capabilities: createCapabilitiesClient(http),
		browser: createBrowserClient(http),

		agent: createAgentClient(http),

		jobs: createJobsClient(http),

		http,
	};
}

export type { AgentClient } from "./agent.js";
export type { AnalyticsClient } from "./analytics.js";
export type { BidsClient } from "./bids.js";
export type { BillingClient } from "./billing.js";
export type { BrowserClient } from "./browser.js";
export type { CapabilitiesClient } from "./capabilities.js";
export type { CategoriesClient } from "./categories.js";
export type { ConnectClient } from "./connect.js";
export type { DisputesClient } from "./disputes.js";
export type { EvaluateClient } from "./evaluate.js";
export type { FeedbackAwaiting, FeedbackClient } from "./feedback.js";
export type { ForwarderClient } from "./forwarder.js";
export type { FlipagentHttp, RequestMethod } from "./http.js";
export { FlipagentApiError } from "./http.js";
export type { ItemsClient } from "./items.js";
export type { JobsClient, JobsListQuery } from "./jobs.js";
export type { KeysClient } from "./keys.js";
export type { LabelsClient } from "./labels.js";
export type { ListingsClient } from "./listings.js";
export type { LocationsClient } from "./locations.js";
export type { MeClient } from "./me.js";
export type { MediaClient } from "./media.js";
export type { MessagesClient } from "./messages.js";
export type { PayoutsClient, TransactionsClient } from "./money.js";
export type { NotificationsClient } from "./notifications.js";
export type { OffersClient } from "./offers.js";
// Stream consumer + phase labels — auth-agnostic helpers shared with
// surfaces that don't go through the bearer-token client (dashboard
// playground, embed iframe). Bearer-token consumers can also use the
// convenience method on `client.evaluate.jobs.stream()`.
export { describeEvaluatePhase } from "./phase.js";
export type { PoliciesClient } from "./policies.js";
export type { ProductsClient } from "./products.js";
export type { PurchasesClient } from "./purchases.js";
export type { RecommendationsClient } from "./recommendations.js";
export type { SalesClient } from "./sales.js";
export type { SellerClient } from "./seller.js";
export type { ShipClient, ShipProviderSummary, ShipProvidersResponse } from "./ship.js";
export {
	type EvaluateStep,
	type EvaluateStreamError,
	type EvaluateStreamEvent,
	type EvaluateStreamOptions,
	type StreamFetcher,
	streamEvaluateJob,
} from "./streams.js";
export type { WebhooksClient } from "./webhooks.js";
