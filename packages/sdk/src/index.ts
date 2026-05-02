/**
 * Typed client for the flipagent API — `api.flipagent.dev`.
 *
 * One client, one API key. Every namespace maps one-to-one to a
 * `/v1/<resource>` route. Layered:
 *
 *   Marketplace data (read):
 *     items, categories, products, charities, media, featured
 *
 *   My side (write):
 *     listings, listingsBulk, listingGroups, locations, purchases, sales
 *
 *   Money + comms + disputes:
 *     payouts, transactions, transfers, messages, offers, feedback,
 *     disputes, policies, violations, recommendations, marketplaces
 *
 *   Intelligence:
 *     evaluate, ship, expenses, trends
 *
 *   Marketing + storefront:
 *     promotions, markdowns, ads, store, analytics, feeds, bids,
 *     translate, labels
 *
 *   My eBay:
 *     seller, watching, savedSearches
 *
 *   Account / ops:
 *     keys, billing, connect, capabilities, takedown, webhooks,
 *     notifications, forwarder
 *
 *   Escape hatch:
 *     http — typed get/post/put/patch/delete for endpoints not yet wrapped
 */

import { type AdsClient, createAdsClient } from "./ads.js";
import { type AnalyticsClient, createAnalyticsClient } from "./analytics.js";
import { type BidsClient, createBidsClient } from "./bids.js";
import { type BillingClient, createBillingClient } from "./billing.js";
import { type CapabilitiesClient, createCapabilitiesClient } from "./capabilities.js";
import { type CategoriesClient, createCategoriesClient } from "./categories.js";
import { type CharitiesClient, createCharitiesClient } from "./charities.js";
import { type ConnectClient, createConnectClient } from "./connect.js";
import { createDisputesClient, type DisputesClient } from "./disputes.js";
import { createEvaluateClient, type EvaluateClient } from "./evaluate.js";
import { createExpensesClient, type ExpensesClient } from "./expenses.js";
import { createFeaturedClient, type FeaturedClient } from "./featured.js";
import { createFeedbackClient, type FeedbackClient } from "./feedback.js";
import { createFeedsClient, type FeedsClient } from "./feeds.js";
import { createForwarderClient, type ForwarderClient } from "./forwarder.js";
import { createHttp, type FlipagentHttp } from "./http.js";
import { createItemsClient, type ItemsClient } from "./items.js";
import { createKeysClient, type KeysClient } from "./keys.js";
import { createLabelsClient, type LabelsClient } from "./labels.js";
import { createListingGroupsClient, type ListingGroupsClient } from "./listing-groups.js";
import { createListingsClient, type ListingsClient } from "./listings.js";
import { createListingsBulkClient, type ListingsBulkClient } from "./listings-bulk.js";
import { createLocationsClient, type LocationsClient } from "./locations.js";
import { createMarkdownsClient, type MarkdownsClient } from "./markdowns.js";
import { createMarketplacesClient, type MarketplacesClient } from "./marketplaces.js";
import { createMediaClient, type MediaClient } from "./media.js";
import { createMessagesClient, type MessagesClient } from "./messages.js";
import { createPayoutsClient, createTransactionsClient, type PayoutsClient, type TransactionsClient } from "./money.js";
import { createNotificationsClient, type NotificationsClient } from "./notifications.js";
import { createOffersClient, type OffersClient } from "./offers.js";
import { createPoliciesClient, type PoliciesClient } from "./policies.js";
import { createProductsClient, type ProductsClient } from "./products.js";
import { createPromotionsClient, type PromotionsClient } from "./promotions.js";
import { createPurchasesClient, type PurchasesClient } from "./purchases.js";
import { createRecommendationsClient, type RecommendationsClient } from "./recommendations.js";
import { createSalesClient, type SalesClient } from "./sales.js";
import { createSavedSearchesClient, type SavedSearchesClient } from "./saved-searches.js";
import { createSellerClient, type SellerClient } from "./seller.js";
import { createShipClient, type ShipClient } from "./ship.js";
import { createStoreClient, type StoreClient } from "./store.js";
import { createTakedownClient, type TakedownClient } from "./takedown.js";
import { createTransfersClient, type TransfersClient } from "./transfers.js";
import { createTranslateClient, type TranslateClient } from "./translate.js";
import { createTrendsClient, type TrendsClient } from "./trends.js";
import { createViolationsClient, type ViolationsClient } from "./violations.js";
import { createWatchingClient, type WatchingClient } from "./watching.js";
import { createWebhooksClient, type WebhooksClient } from "./webhooks.js";

export interface FlipagentClientOptions {
	apiKey: string;
	baseUrl?: string;
	fetch?: typeof globalThis.fetch;
}

export interface FlipagentClient {
	// Marketplace data (read)
	items: ItemsClient;
	categories: CategoriesClient;
	products: ProductsClient;
	charities: CharitiesClient;
	media: MediaClient;
	featured: FeaturedClient;

	// My side (write)
	listings: ListingsClient;
	listingsBulk: ListingsBulkClient;
	listingGroups: ListingGroupsClient;
	locations: LocationsClient;
	purchases: PurchasesClient;
	sales: SalesClient;

	// Money + comms + disputes
	payouts: PayoutsClient;
	transactions: TransactionsClient;
	transfers: TransfersClient;
	messages: MessagesClient;
	offers: OffersClient;
	feedback: FeedbackClient;
	disputes: DisputesClient;
	policies: PoliciesClient;
	violations: ViolationsClient;
	recommendations: RecommendationsClient;
	marketplaces: MarketplacesClient;

	// Intelligence
	evaluate: EvaluateClient;
	ship: ShipClient;
	expenses: ExpensesClient;
	trends: TrendsClient;

	// Marketing + storefront
	promotions: PromotionsClient;
	markdowns: MarkdownsClient;
	ads: AdsClient;
	store: StoreClient;
	analytics: AnalyticsClient;
	feeds: FeedsClient;
	bids: BidsClient;
	translate: TranslateClient;
	labels: LabelsClient;

	// My eBay surfaces
	seller: SellerClient;
	watching: WatchingClient;
	savedSearches: SavedSearchesClient;

	// Account / ops
	keys: KeysClient;
	billing: BillingClient;
	connect: ConnectClient;
	capabilities: CapabilitiesClient;
	takedown: TakedownClient;
	webhooks: WebhooksClient;
	notifications: NotificationsClient;
	forwarder: ForwarderClient;

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
		charities: createCharitiesClient(http),
		media: createMediaClient(http),
		featured: createFeaturedClient(http),

		listings: createListingsClient(http),
		listingsBulk: createListingsBulkClient(http),
		listingGroups: createListingGroupsClient(http),
		locations: createLocationsClient(http),
		purchases: createPurchasesClient(http),
		sales: createSalesClient(http),

		payouts: createPayoutsClient(http),
		transactions: createTransactionsClient(http),
		transfers: createTransfersClient(http),
		messages: createMessagesClient(http),
		offers: createOffersClient(http),
		feedback: createFeedbackClient(http),
		disputes: createDisputesClient(http),
		policies: createPoliciesClient(http),
		violations: createViolationsClient(http),
		recommendations: createRecommendationsClient(http),
		marketplaces: createMarketplacesClient(http),

		evaluate: createEvaluateClient(http),
		ship: createShipClient(http),
		expenses: createExpensesClient(http),
		trends: createTrendsClient(http),

		promotions: createPromotionsClient(http),
		markdowns: createMarkdownsClient(http),
		ads: createAdsClient(http),
		store: createStoreClient(http),
		analytics: createAnalyticsClient(http),
		feeds: createFeedsClient(http),
		bids: createBidsClient(http),
		translate: createTranslateClient(http),
		labels: createLabelsClient(http),

		seller: createSellerClient(http),
		watching: createWatchingClient(http),
		savedSearches: createSavedSearchesClient(http),

		keys: createKeysClient(http),
		billing: createBillingClient(http),
		connect: createConnectClient(http),
		capabilities: createCapabilitiesClient(http),
		takedown: createTakedownClient(http),
		webhooks: createWebhooksClient(http),
		notifications: createNotificationsClient(http),
		forwarder: createForwarderClient(http),

		http,
	};
}

export type { AdsClient } from "./ads.js";
export type { AnalyticsClient } from "./analytics.js";
export type { BidsClient } from "./bids.js";
export type { BillingClient } from "./billing.js";
export type { CapabilitiesClient } from "./capabilities.js";
export type { CategoriesClient } from "./categories.js";
export type { CharitiesClient } from "./charities.js";
export type { ConnectClient } from "./connect.js";
export type { DisputesClient } from "./disputes.js";
export type { EvaluateClient } from "./evaluate.js";
export type { ExpensesClient, ExpensesSummaryParams } from "./expenses.js";
export type { FeaturedClient } from "./featured.js";
export type { FeedbackAwaiting, FeedbackClient } from "./feedback.js";
export type { FeedsClient } from "./feeds.js";
export type { ForwarderClient } from "./forwarder.js";
export type { FlipagentHttp, RequestMethod } from "./http.js";
export { FlipagentApiError } from "./http.js";
export type { ItemsClient } from "./items.js";
export type { KeysClient } from "./keys.js";
export type { LabelsClient } from "./labels.js";
export type { ListingGroupsClient } from "./listing-groups.js";
export type { ListingsClient } from "./listings.js";
export type { ListingsBulkClient } from "./listings-bulk.js";
export type { LocationsClient } from "./locations.js";
export type { MarkdownsClient } from "./markdowns.js";
export type { MarketplacesClient } from "./marketplaces.js";
export type { MediaClient } from "./media.js";
export type { MessagesClient } from "./messages.js";
export type { PayoutsClient, TransactionsClient } from "./money.js";
export type { NotificationsClient } from "./notifications.js";
export type { OffersClient } from "./offers.js";
export type { PoliciesClient } from "./policies.js";
export type { ProductsClient } from "./products.js";
export type { PromotionsClient } from "./promotions.js";
export type { PurchasesClient } from "./purchases.js";
export type { RecommendationsClient } from "./recommendations.js";
export type { SalesClient } from "./sales.js";
export type { SavedSearchesClient } from "./saved-searches.js";
export type { SellerClient } from "./seller.js";
export type { ShipClient, ShipProviderSummary, ShipProvidersResponse } from "./ship.js";
export type { StoreClient } from "./store.js";
export type { TakedownClient } from "./takedown.js";
export type { TransfersClient } from "./transfers.js";
export type { TranslateClient } from "./translate.js";
export type { TrendsClient } from "./trends.js";
export type { ViolationsClient } from "./violations.js";
export type { WatchingClient } from "./watching.js";
export type { WebhooksClient } from "./webhooks.js";
