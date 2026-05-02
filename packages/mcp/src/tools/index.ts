import type { TSchema } from "@sinclair/typebox";
import type { Config } from "../config.js";
import {
	adsAdsListDescription,
	adsAdsListExecute,
	adsAdsListInput,
	adsCampaignsCreateDescription,
	adsCampaignsCreateExecute,
	adsCampaignsCreateInput,
	adsCampaignsListDescription,
	adsCampaignsListExecute,
	adsCampaignsListInput,
	adsGroupsCreateDescription,
	adsGroupsCreateExecute,
	adsGroupsCreateInput,
	adsGroupsListDescription,
	adsGroupsListExecute,
	adsGroupsListInput,
	adsReportsCreateDescription,
	adsReportsCreateExecute,
	adsReportsCreateInput,
	adsReportsGetDescription,
	adsReportsGetExecute,
	adsReportsGetInput,
	adsReportsListDescription,
	adsReportsListExecute,
	adsReportsListInput,
	adsReportsMetadataDescription,
	adsReportsMetadataExecute,
	adsReportsMetadataInput,
} from "./ads.js";
import {
	bidsEligibleListingsDescription,
	bidsEligibleListingsExecute,
	bidsEligibleListingsInput,
	bidsListDescription,
	bidsListExecute,
	bidsListInput,
	bidsPlaceDescription,
	bidsPlaceExecute,
	bidsPlaceInput,
} from "./bids.js";
import { browserQueryDescription, browserQueryExecute, browserQueryInput } from "./browser-primitives.js";
import {
	disputesGetDescription,
	disputesGetExecute,
	disputesGetInput,
	disputesListDescription,
	disputesListExecute,
	disputesListInput,
	disputesRespondDescription,
	disputesRespondExecute,
	disputesRespondInput,
} from "./disputes.js";
import {
	ebayBuyItemDescription,
	ebayBuyItemExecute,
	ebayBuyItemInput,
	ebayOrderCancelDescription,
	ebayOrderCancelExecute,
	ebayOrderCancelInput,
	ebayOrderStatusDescription,
	ebayOrderStatusExecute,
	ebayOrderStatusInput,
} from "./ebay-buy.js";
import { ebayItemDetailDescription, ebayItemDetailExecute, ebayItemDetailInput } from "./ebay-item-detail.js";
import {
	ebayCreateInventoryItemDescription,
	ebayCreateInventoryItemExecute,
	ebayCreateInventoryItemInput,
	ebayCreateOfferDescription,
	ebayCreateOfferExecute,
	ebayCreateOfferInput,
	ebayPublishOfferDescription,
	ebayPublishOfferExecute,
	ebayPublishOfferInput,
} from "./ebay-listings.js";
import { ebayListPayoutsDescription, ebayListPayoutsExecute, ebayListPayoutsInput } from "./ebay-payouts.js";
import {
	ebayListOrdersDescription,
	ebayListOrdersExecute,
	ebayListOrdersInput,
	ebayMarkShippedDescription,
	ebayMarkShippedExecute,
	ebayMarkShippedInput,
} from "./ebay-sales.js";
import { ebaySearchDescription, ebaySearchExecute, ebaySearchInput } from "./ebay-search.js";
import { ebaySoldSearchDescription, ebaySoldSearchExecute, ebaySoldSearchInput } from "./ebay-sold-search.js";
import {
	ebayTaxonomyAspectsDescription,
	ebayTaxonomyAspectsExecute,
	ebayTaxonomyAspectsInput,
	ebayTaxonomyDefaultIdDescription,
	ebayTaxonomyDefaultIdExecute,
	ebayTaxonomyDefaultIdInput,
	ebayTaxonomySuggestDescription,
	ebayTaxonomySuggestExecute,
	ebayTaxonomySuggestInput,
} from "./ebay-taxonomy.js";
import { evaluateListingDescription, evaluateListingExecute, evaluateListingInput } from "./evaluate-listing.js";
import { expensesRecordDescription, expensesRecordExecute, expensesRecordInput } from "./expenses-record.js";
import { expensesSummaryDescription, expensesSummaryExecute, expensesSummaryInput } from "./expenses-summary.js";
import {
	feedbackAwaitingDescription,
	feedbackAwaitingExecute,
	feedbackAwaitingInput,
	feedbackLeaveDescription,
	feedbackLeaveExecute,
	feedbackLeaveInput,
	feedbackListDescription,
	feedbackListExecute,
	feedbackListInput,
} from "./feedback.js";
import {
	flipagentCapabilitiesDescription,
	flipagentCapabilitiesExecute,
	flipagentCapabilitiesInput,
} from "./flipagent-capabilities.js";
import {
	flipagentConnectStatusDescription,
	flipagentConnectStatusExecute,
	flipagentConnectStatusInput,
} from "./flipagent-connect.js";
import {
	planetExpressInventoryDescription,
	planetExpressInventoryExecute,
	planetExpressInventoryInput,
	planetExpressJobStatusDescription,
	planetExpressJobStatusExecute,
	planetExpressJobStatusInput,
	planetExpressLinkDescription,
	planetExpressLinkExecute,
	planetExpressLinkInput,
	planetExpressPackageDispatchDescription,
	planetExpressPackageDispatchExecute,
	planetExpressPackageDispatchInput,
	planetExpressPackagePhotosDescription,
	planetExpressPackagePhotosExecute,
	planetExpressPackagePhotosInput,
	planetExpressPackagesDescription,
	planetExpressPackagesExecute,
	planetExpressPackagesInput,
} from "./forwarder-planetexpress.js";
import { keysMeDescription, keysMeExecute, keysMeInput } from "./keys.js";
import {
	listingGroupsDeleteDescription,
	listingGroupsDeleteExecute,
	listingGroupsDeleteInput,
	listingGroupsGetDescription,
	listingGroupsGetExecute,
	listingGroupsGetInput,
	listingGroupsUpsertDescription,
	listingGroupsUpsertExecute,
	listingGroupsUpsertInput,
} from "./listing-groups.js";
import {
	listingsBulkGetInventoryDescription,
	listingsBulkGetInventoryExecute,
	listingsBulkGetInventoryInput,
	listingsBulkGetOffersDescription,
	listingsBulkGetOffersExecute,
	listingsBulkGetOffersInput,
	listingsBulkMigrateDescription,
	listingsBulkMigrateExecute,
	listingsBulkMigrateInput,
	listingsBulkPublishDescription,
	listingsBulkPublishExecute,
	listingsBulkPublishInput,
	listingsBulkUpdatePricesDescription,
	listingsBulkUpdatePricesExecute,
	listingsBulkUpdatePricesInput,
	listingsBulkUpsertDescription,
	listingsBulkUpsertExecute,
	listingsBulkUpsertInput,
} from "./listings-bulk.js";
import {
	locationsDeleteDescription,
	locationsDeleteExecute,
	locationsDeleteInput,
	locationsDisableDescription,
	locationsDisableExecute,
	locationsDisableInput,
	locationsEnableDescription,
	locationsEnableExecute,
	locationsEnableInput,
	locationsGetDescription,
	locationsGetExecute,
	locationsGetInput,
	locationsListDescription,
	locationsListExecute,
	locationsListInput,
	locationsUpsertDescription,
	locationsUpsertExecute,
	locationsUpsertInput,
} from "./locations.js";
import {
	markdownsCreateDescription,
	markdownsCreateExecute,
	markdownsCreateInput,
	markdownsListDescription,
	markdownsListExecute,
	markdownsListInput,
} from "./markdowns.js";
import {
	mediaCreateUploadDescription,
	mediaCreateUploadExecute,
	mediaCreateUploadInput,
	mediaGetDescription,
	mediaGetExecute,
	mediaGetInput,
} from "./media.js";
import {
	messagesListDescription,
	messagesListExecute,
	messagesListInput,
	messagesSendDescription,
	messagesSendExecute,
	messagesSendInput,
} from "./messages.js";
import {
	notificationsDestinationsDescription,
	notificationsDestinationsExecute,
	notificationsDestinationsInput,
	notificationsRecentDescription,
	notificationsRecentExecute,
	notificationsRecentInput,
	notificationsSubscriptionsCreateDescription,
	notificationsSubscriptionsCreateExecute,
	notificationsSubscriptionsCreateInput,
	notificationsSubscriptionsDeleteDescription,
	notificationsSubscriptionsDeleteExecute,
	notificationsSubscriptionsDeleteInput,
	notificationsSubscriptionsGetDescription,
	notificationsSubscriptionsGetExecute,
	notificationsSubscriptionsGetInput,
	notificationsSubscriptionsListDescription,
	notificationsSubscriptionsListExecute,
	notificationsSubscriptionsListInput,
	notificationsTopicsDescription,
	notificationsTopicsExecute,
	notificationsTopicsInput,
} from "./notifications.js";
import {
	offersCreateDescription,
	offersCreateExecute,
	offersCreateInput,
	offersEligibleListingsDescription,
	offersEligibleListingsExecute,
	offersEligibleListingsInput,
	offersListDescription,
	offersListExecute,
	offersListInput,
	offersRespondDescription,
	offersRespondExecute,
	offersRespondInput,
} from "./offers.js";
import {
	policiesListByTypeDescription,
	policiesListByTypeExecute,
	policiesListByTypeInput,
	policiesListDescription,
	policiesListExecute,
	policiesListInput,
} from "./policies.js";
import {
	promotionsCreateDescription,
	promotionsCreateExecute,
	promotionsCreateInput,
	promotionsListDescription,
	promotionsListExecute,
	promotionsListInput,
	promotionsReportsCreateDescription,
	promotionsReportsCreateExecute,
	promotionsReportsCreateInput,
	promotionsReportsGetDescription,
	promotionsReportsGetExecute,
	promotionsReportsGetInput,
	promotionsReportsListDescription,
	promotionsReportsListExecute,
	promotionsReportsListInput,
} from "./promotions.js";
import {
	recommendationsListDescription,
	recommendationsListExecute,
	recommendationsListInput,
} from "./recommendations.js";
import {
	savedSearchesCreateDescription,
	savedSearchesCreateExecute,
	savedSearchesCreateInput,
	savedSearchesDeleteDescription,
	savedSearchesDeleteExecute,
	savedSearchesDeleteInput,
	savedSearchesListDescription,
	savedSearchesListExecute,
	savedSearchesListInput,
} from "./saved-searches.js";
import {
	sellerAdvertisingEligibilityDescription,
	sellerAdvertisingEligibilityExecute,
	sellerAdvertisingEligibilityInput,
	sellerEligibilityDescription,
	sellerEligibilityExecute,
	sellerEligibilityInput,
	sellerKycDescription,
	sellerKycExecute,
	sellerKycInput,
	sellerPaymentsProgramDescription,
	sellerPaymentsProgramExecute,
	sellerPaymentsProgramInput,
	sellerPrivilegeDescription,
	sellerPrivilegeExecute,
	sellerPrivilegeInput,
	sellerSalesTaxDescription,
	sellerSalesTaxExecute,
	sellerSalesTaxInput,
	sellerSubscriptionDescription,
	sellerSubscriptionExecute,
	sellerSubscriptionInput,
} from "./seller.js";
import { shipProvidersDescription, shipProvidersExecute, shipProvidersInput } from "./ship-providers.js";
import { shipQuoteDescription, shipQuoteExecute, shipQuoteInput } from "./ship-quote.js";
import {
	storeCategoriesDescription,
	storeCategoriesExecute,
	storeCategoriesInput,
	storeCategoriesUpsertDescription,
	storeCategoriesUpsertExecute,
	storeCategoriesUpsertInput,
} from "./store.js";
import { transactionsListDescription, transactionsListExecute, transactionsListInput } from "./transactions.js";
import { trendsCategoriesDescription, trendsCategoriesExecute, trendsCategoriesInput } from "./trends.js";
import {
	watchingListDescription,
	watchingListExecute,
	watchingListInput,
	watchingUnwatchDescription,
	watchingUnwatchExecute,
	watchingUnwatchInput,
	watchingWatchDescription,
	watchingWatchExecute,
	watchingWatchInput,
} from "./watching.js";
import {
	webhooksListDescription,
	webhooksListExecute,
	webhooksListInput,
	webhooksRegisterDescription,
	webhooksRegisterExecute,
	webhooksRegisterInput,
	webhooksRevokeDescription,
	webhooksRevokeExecute,
	webhooksRevokeInput,
} from "./webhooks.js";

export interface Tool {
	name: string;
	description: string;
	inputSchema: TSchema;
	execute: (config: Config, args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Tool naming convention: `flipagent_<resource>_<verb>`, snake_case, mirroring
 * the `/v1/<resource>/<verb>` route surface. Marketplace stays a *parameter*,
 * never part of the tool name (Amazon/Mercari adapters reuse the same names).
 * Verb vocabulary: list, get, search, create, update, relist, cancel, publish,
 * ship, suggest, aspects, quote. Per Anthropic's "Writing tools for agents"
 * guidance, the prefix avoids collisions when other MCP servers are loaded
 * alongside flipagent. https://www.anthropic.com/engineering/writing-tools-for-agents
 */
export const tools: Tool[] = [
	// Marketplace data — read (anonymous app token is enough)
	{
		name: "flipagent_items_search",
		description: ebaySearchDescription,
		inputSchema: ebaySearchInput,
		execute: ebaySearchExecute,
	},
	{
		name: "flipagent_items_get",
		description: ebayItemDetailDescription,
		inputSchema: ebayItemDetailInput,
		execute: ebayItemDetailExecute,
	},
	{
		name: "flipagent_items_search_sold",
		description: ebaySoldSearchDescription,
		inputSchema: ebaySoldSearchInput,
		execute: ebaySoldSearchExecute,
	},
	{
		name: "flipagent_categories_list",
		description: ebayTaxonomyDefaultIdDescription,
		inputSchema: ebayTaxonomyDefaultIdInput,
		execute: ebayTaxonomyDefaultIdExecute,
	},
	{
		name: "flipagent_categories_suggest",
		description: ebayTaxonomySuggestDescription,
		inputSchema: ebayTaxonomySuggestInput,
		execute: ebayTaxonomySuggestExecute,
	},
	{
		name: "flipagent_categories_aspects",
		description: ebayTaxonomyAspectsDescription,
		inputSchema: ebayTaxonomyAspectsInput,
		execute: ebayTaxonomyAspectsExecute,
	},

	// flipagent management — capabilities is the agent's first call;
	// connect_ebay_status stays for back-compat (narrower view of the same data).
	{
		name: "flipagent_capabilities",
		description: flipagentCapabilitiesDescription,
		inputSchema: flipagentCapabilitiesInput,
		execute: flipagentCapabilitiesExecute,
	},
	{
		name: "flipagent_connect_ebay_status",
		description: flipagentConnectStatusDescription,
		inputSchema: flipagentConnectStatusInput,
		execute: flipagentConnectStatusExecute,
	},

	// Listing prerequisites — `flipagent_listings_create` references
	// policy ids, location ids, and media URLs. Agents should fetch /
	// upsert these first, then call listings_create.
	{
		name: "flipagent_media_create_upload",
		description: mediaCreateUploadDescription,
		inputSchema: mediaCreateUploadInput,
		execute: mediaCreateUploadExecute,
	},
	{
		name: "flipagent_media_get",
		description: mediaGetDescription,
		inputSchema: mediaGetInput,
		execute: mediaGetExecute,
	},
	{
		name: "flipagent_policies_list",
		description: policiesListDescription,
		inputSchema: policiesListInput,
		execute: policiesListExecute,
	},
	{
		name: "flipagent_policies_list_by_type",
		description: policiesListByTypeDescription,
		inputSchema: policiesListByTypeInput,
		execute: policiesListByTypeExecute,
	},
	{
		name: "flipagent_locations_list",
		description: locationsListDescription,
		inputSchema: locationsListInput,
		execute: locationsListExecute,
	},
	{
		name: "flipagent_locations_get",
		description: locationsGetDescription,
		inputSchema: locationsGetInput,
		execute: locationsGetExecute,
	},
	{
		name: "flipagent_locations_upsert",
		description: locationsUpsertDescription,
		inputSchema: locationsUpsertInput,
		execute: locationsUpsertExecute,
	},
	{
		name: "flipagent_locations_delete",
		description: locationsDeleteDescription,
		inputSchema: locationsDeleteInput,
		execute: locationsDeleteExecute,
	},
	{
		name: "flipagent_locations_enable",
		description: locationsEnableDescription,
		inputSchema: locationsEnableInput,
		execute: locationsEnableExecute,
	},
	{
		name: "flipagent_locations_disable",
		description: locationsDisableDescription,
		inputSchema: locationsDisableInput,
		execute: locationsDisableExecute,
	},

	// Sell-side (user OAuth required; 401 not_connected if not bound)
	{
		name: "flipagent_listings_create",
		description: ebayCreateInventoryItemDescription,
		inputSchema: ebayCreateInventoryItemInput,
		execute: ebayCreateInventoryItemExecute,
	},
	{
		name: "flipagent_listings_update",
		description: ebayCreateOfferDescription,
		inputSchema: ebayCreateOfferInput,
		execute: ebayCreateOfferExecute,
	},
	{
		name: "flipagent_listings_relist",
		description: ebayPublishOfferDescription,
		inputSchema: ebayPublishOfferInput,
		execute: ebayPublishOfferExecute,
	},
	{
		name: "flipagent_sales_list",
		description: ebayListOrdersDescription,
		inputSchema: ebayListOrdersInput,
		execute: ebayListOrdersExecute,
	},
	{
		name: "flipagent_sales_ship",
		description: ebayMarkShippedDescription,
		inputSchema: ebayMarkShippedInput,
		execute: ebayMarkShippedExecute,
	},
	{
		name: "flipagent_payouts_list",
		description: ebayListPayoutsDescription,
		inputSchema: ebayListPayoutsInput,
		execute: ebayListPayoutsExecute,
	},
	{
		name: "flipagent_transactions_list",
		description: transactionsListDescription,
		inputSchema: transactionsListInput,
		execute: transactionsListExecute,
	},

	// Buyer comms + post-sale (deal turnover)
	{
		name: "flipagent_messages_list",
		description: messagesListDescription,
		inputSchema: messagesListInput,
		execute: messagesListExecute,
	},
	{
		name: "flipagent_messages_send",
		description: messagesSendDescription,
		inputSchema: messagesSendInput,
		execute: messagesSendExecute,
	},
	{
		name: "flipagent_offers_list",
		description: offersListDescription,
		inputSchema: offersListInput,
		execute: offersListExecute,
	},
	{
		name: "flipagent_offers_create",
		description: offersCreateDescription,
		inputSchema: offersCreateInput,
		execute: offersCreateExecute,
	},
	{
		name: "flipagent_offers_eligible_listings",
		description: offersEligibleListingsDescription,
		inputSchema: offersEligibleListingsInput,
		execute: offersEligibleListingsExecute,
	},
	{
		name: "flipagent_offers_respond",
		description: offersRespondDescription,
		inputSchema: offersRespondInput,
		execute: offersRespondExecute,
	},
	{
		name: "flipagent_disputes_list",
		description: disputesListDescription,
		inputSchema: disputesListInput,
		execute: disputesListExecute,
	},
	{
		name: "flipagent_disputes_get",
		description: disputesGetDescription,
		inputSchema: disputesGetInput,
		execute: disputesGetExecute,
	},
	{
		name: "flipagent_disputes_respond",
		description: disputesRespondDescription,
		inputSchema: disputesRespondInput,
		execute: disputesRespondExecute,
	},
	{
		name: "flipagent_feedback_list",
		description: feedbackListDescription,
		inputSchema: feedbackListInput,
		execute: feedbackListExecute,
	},
	{
		name: "flipagent_feedback_awaiting",
		description: feedbackAwaitingDescription,
		inputSchema: feedbackAwaitingInput,
		execute: feedbackAwaitingExecute,
	},
	{
		name: "flipagent_feedback_leave",
		description: feedbackLeaveDescription,
		inputSchema: feedbackLeaveInput,
		execute: feedbackLeaveExecute,
	},

	// Evaluate — single-listing judgment (Decisions pillar)
	{
		name: "flipagent_evaluate",
		description: evaluateListingDescription,
		inputSchema: evaluateListingInput,
		execute: evaluateListingExecute,
	},

	// Ship — forwarder quote + catalog (Operations pillar)
	{
		name: "flipagent_ship_quote",
		description: shipQuoteDescription,
		inputSchema: shipQuoteInput,
		execute: shipQuoteExecute,
	},
	{
		name: "flipagent_ship_providers",
		description: shipProvidersDescription,
		inputSchema: shipProvidersInput,
		execute: shipProvidersExecute,
	},

	// Expenses — append-only cost-side ledger (Finance phase, our half).
	// Verb is `record` (not `create`) because the route is /expenses/record
	// and the SDK is `client.expenses.record()` — append-only ledger,
	// not generic CRUD.
	{
		name: "flipagent_expenses_record",
		description: expensesRecordDescription,
		inputSchema: expensesRecordInput,
		execute: expensesRecordExecute,
	},
	{
		name: "flipagent_expenses_summary",
		description: expensesSummaryDescription,
		inputSchema: expensesSummaryInput,
		execute: expensesSummaryExecute,
	},

	// Buy — extension-bridged purchase flow. The user must install the
	// flipagent Chrome extension and pair it with their API key (one-time,
	// via the extension options panel) for the order to actually be driven
	// against their logged-in eBay session. These tools always succeed at
	// the API layer (they queue); the extension does the rest. See
	// /docs/extension/ for install + pairing.
	{
		name: "flipagent_purchases_create",
		description: ebayBuyItemDescription,
		inputSchema: ebayBuyItemInput,
		execute: ebayBuyItemExecute,
	},
	{
		name: "flipagent_purchases_get",
		description: ebayOrderStatusDescription,
		inputSchema: ebayOrderStatusInput,
		execute: ebayOrderStatusExecute,
	},
	{
		name: "flipagent_purchases_cancel",
		description: ebayOrderCancelDescription,
		inputSchema: ebayOrderCancelInput,
		execute: ebayOrderCancelExecute,
	},

	// Forwarders — `/v1/forwarder/{provider}/*`. Today only Planet Express
	// is wired, so these tools target PE; the names are provider-agnostic
	// because future forwarders will reuse the same paths via a `provider`
	// param. Each name mirrors the SDK path with dots replaced by
	// underscores (e.g. `forwarder.packages.photos` ↔
	// `flipagent_forwarder_packages_photos`). All queue a bridge job and
	// return a `jobId`; agents poll `flipagent_forwarder_jobs_get`.
	{
		name: "flipagent_forwarder_refresh",
		description: planetExpressPackagesDescription,
		inputSchema: planetExpressPackagesInput,
		execute: planetExpressPackagesExecute,
	},
	{
		name: "flipagent_forwarder_packages_photos",
		description: planetExpressPackagePhotosDescription,
		inputSchema: planetExpressPackagePhotosInput,
		execute: planetExpressPackagePhotosExecute,
	},
	{
		name: "flipagent_forwarder_packages_dispatch",
		description: planetExpressPackageDispatchDescription,
		inputSchema: planetExpressPackageDispatchInput,
		execute: planetExpressPackageDispatchExecute,
	},
	{
		name: "flipagent_forwarder_jobs_get",
		description: planetExpressJobStatusDescription,
		inputSchema: planetExpressJobStatusInput,
		execute: planetExpressJobStatusExecute,
	},
	{
		name: "flipagent_forwarder_inventory_list",
		description: planetExpressInventoryDescription,
		inputSchema: planetExpressInventoryInput,
		execute: planetExpressInventoryExecute,
	},
	{
		name: "flipagent_forwarder_packages_link",
		description: planetExpressLinkDescription,
		inputSchema: planetExpressLinkInput,
		execute: planetExpressLinkExecute,
	},

	// Sourcing radar — query-based + item-based standing alerts, plus
	// trend signals + flipagent's own recommendations.
	{
		name: "flipagent_watching_list",
		description: watchingListDescription,
		inputSchema: watchingListInput,
		execute: watchingListExecute,
	},
	{
		name: "flipagent_watching_watch",
		description: watchingWatchDescription,
		inputSchema: watchingWatchInput,
		execute: watchingWatchExecute,
	},
	{
		name: "flipagent_watching_unwatch",
		description: watchingUnwatchDescription,
		inputSchema: watchingUnwatchInput,
		execute: watchingUnwatchExecute,
	},
	{
		name: "flipagent_saved_searches_list",
		description: savedSearchesListDescription,
		inputSchema: savedSearchesListInput,
		execute: savedSearchesListExecute,
	},
	{
		name: "flipagent_saved_searches_create",
		description: savedSearchesCreateDescription,
		inputSchema: savedSearchesCreateInput,
		execute: savedSearchesCreateExecute,
	},
	{
		name: "flipagent_saved_searches_delete",
		description: savedSearchesDeleteDescription,
		inputSchema: savedSearchesDeleteInput,
		execute: savedSearchesDeleteExecute,
	},
	{
		name: "flipagent_trends_categories",
		description: trendsCategoriesDescription,
		inputSchema: trendsCategoriesInput,
		execute: trendsCategoriesExecute,
	},
	{
		name: "flipagent_recommendations_list",
		description: recommendationsListDescription,
		inputSchema: recommendationsListInput,
		execute: recommendationsListExecute,
	},
	{
		name: "flipagent_bids_list",
		description: bidsListDescription,
		inputSchema: bidsListInput,
		execute: bidsListExecute,
	},
	{
		name: "flipagent_bids_place",
		description: bidsPlaceDescription,
		inputSchema: bidsPlaceInput,
		execute: bidsPlaceExecute,
	},
	{
		name: "flipagent_bids_eligible_listings",
		description: bidsEligibleListingsDescription,
		inputSchema: bidsEligibleListingsInput,
		execute: bidsEligibleListingsExecute,
	},

	// Seller account — read-only views on standing, KYC, subscription.
	{
		name: "flipagent_seller_eligibility",
		description: sellerEligibilityDescription,
		inputSchema: sellerEligibilityInput,
		execute: sellerEligibilityExecute,
	},
	{
		name: "flipagent_seller_privilege",
		description: sellerPrivilegeDescription,
		inputSchema: sellerPrivilegeInput,
		execute: sellerPrivilegeExecute,
	},
	{
		name: "flipagent_seller_kyc",
		description: sellerKycDescription,
		inputSchema: sellerKycInput,
		execute: sellerKycExecute,
	},
	{
		name: "flipagent_seller_subscription",
		description: sellerSubscriptionDescription,
		inputSchema: sellerSubscriptionInput,
		execute: sellerSubscriptionExecute,
	},
	{
		name: "flipagent_seller_payments_program",
		description: sellerPaymentsProgramDescription,
		inputSchema: sellerPaymentsProgramInput,
		execute: sellerPaymentsProgramExecute,
	},
	{
		name: "flipagent_seller_advertising_eligibility",
		description: sellerAdvertisingEligibilityDescription,
		inputSchema: sellerAdvertisingEligibilityInput,
		execute: sellerAdvertisingEligibilityExecute,
	},
	{
		name: "flipagent_seller_sales_tax",
		description: sellerSalesTaxDescription,
		inputSchema: sellerSalesTaxInput,
		execute: sellerSalesTaxExecute,
	},

	// Marketing + storefront — promotions, markdowns, ads, store.
	{
		name: "flipagent_promotions_list",
		description: promotionsListDescription,
		inputSchema: promotionsListInput,
		execute: promotionsListExecute,
	},
	{
		name: "flipagent_promotions_create",
		description: promotionsCreateDescription,
		inputSchema: promotionsCreateInput,
		execute: promotionsCreateExecute,
	},
	{
		name: "flipagent_promotions_reports_list",
		description: promotionsReportsListDescription,
		inputSchema: promotionsReportsListInput,
		execute: promotionsReportsListExecute,
	},
	{
		name: "flipagent_promotions_reports_create",
		description: promotionsReportsCreateDescription,
		inputSchema: promotionsReportsCreateInput,
		execute: promotionsReportsCreateExecute,
	},
	{
		name: "flipagent_promotions_reports_get",
		description: promotionsReportsGetDescription,
		inputSchema: promotionsReportsGetInput,
		execute: promotionsReportsGetExecute,
	},
	{
		name: "flipagent_markdowns_list",
		description: markdownsListDescription,
		inputSchema: markdownsListInput,
		execute: markdownsListExecute,
	},
	{
		name: "flipagent_markdowns_create",
		description: markdownsCreateDescription,
		inputSchema: markdownsCreateInput,
		execute: markdownsCreateExecute,
	},
	{
		name: "flipagent_ads_campaigns_list",
		description: adsCampaignsListDescription,
		inputSchema: adsCampaignsListInput,
		execute: adsCampaignsListExecute,
	},
	{
		name: "flipagent_ads_campaigns_create",
		description: adsCampaignsCreateDescription,
		inputSchema: adsCampaignsCreateInput,
		execute: adsCampaignsCreateExecute,
	},
	{
		name: "flipagent_ads_ads_list",
		description: adsAdsListDescription,
		inputSchema: adsAdsListInput,
		execute: adsAdsListExecute,
	},
	{
		name: "flipagent_ads_groups_list",
		description: adsGroupsListDescription,
		inputSchema: adsGroupsListInput,
		execute: adsGroupsListExecute,
	},
	{
		name: "flipagent_ads_groups_create",
		description: adsGroupsCreateDescription,
		inputSchema: adsGroupsCreateInput,
		execute: adsGroupsCreateExecute,
	},
	{
		name: "flipagent_ads_reports_metadata",
		description: adsReportsMetadataDescription,
		inputSchema: adsReportsMetadataInput,
		execute: adsReportsMetadataExecute,
	},
	{
		name: "flipagent_ads_reports_list",
		description: adsReportsListDescription,
		inputSchema: adsReportsListInput,
		execute: adsReportsListExecute,
	},
	{
		name: "flipagent_ads_reports_create",
		description: adsReportsCreateDescription,
		inputSchema: adsReportsCreateInput,
		execute: adsReportsCreateExecute,
	},
	{
		name: "flipagent_ads_reports_get",
		description: adsReportsGetDescription,
		inputSchema: adsReportsGetInput,
		execute: adsReportsGetExecute,
	},
	{
		name: "flipagent_store_categories",
		description: storeCategoriesDescription,
		inputSchema: storeCategoriesInput,
		execute: storeCategoriesExecute,
	},
	{
		name: "flipagent_store_categories_upsert",
		description: storeCategoriesUpsertDescription,
		inputSchema: storeCategoriesUpsertInput,
		execute: storeCategoriesUpsertExecute,
	},

	// Listing groups + bulk listing ops — variations + power-user batch
	// surfaces. Bulk endpoints return per-row results (partial success
	// is normal); agents iterate the result.
	{
		name: "flipagent_listing_groups_get",
		description: listingGroupsGetDescription,
		inputSchema: listingGroupsGetInput,
		execute: listingGroupsGetExecute,
	},
	{
		name: "flipagent_listing_groups_upsert",
		description: listingGroupsUpsertDescription,
		inputSchema: listingGroupsUpsertInput,
		execute: listingGroupsUpsertExecute,
	},
	{
		name: "flipagent_listing_groups_delete",
		description: listingGroupsDeleteDescription,
		inputSchema: listingGroupsDeleteInput,
		execute: listingGroupsDeleteExecute,
	},
	{
		name: "flipagent_listings_bulk_get_inventory",
		description: listingsBulkGetInventoryDescription,
		inputSchema: listingsBulkGetInventoryInput,
		execute: listingsBulkGetInventoryExecute,
	},
	{
		name: "flipagent_listings_bulk_get_offers",
		description: listingsBulkGetOffersDescription,
		inputSchema: listingsBulkGetOffersInput,
		execute: listingsBulkGetOffersExecute,
	},
	{
		name: "flipagent_listings_bulk_update_prices",
		description: listingsBulkUpdatePricesDescription,
		inputSchema: listingsBulkUpdatePricesInput,
		execute: listingsBulkUpdatePricesExecute,
	},
	{
		name: "flipagent_listings_bulk_upsert",
		description: listingsBulkUpsertDescription,
		inputSchema: listingsBulkUpsertInput,
		execute: listingsBulkUpsertExecute,
	},
	{
		name: "flipagent_listings_bulk_publish",
		description: listingsBulkPublishDescription,
		inputSchema: listingsBulkPublishInput,
		execute: listingsBulkPublishExecute,
	},
	{
		name: "flipagent_listings_bulk_migrate",
		description: listingsBulkMigrateDescription,
		inputSchema: listingsBulkMigrateInput,
		execute: listingsBulkMigrateExecute,
	},

	// Setup-time — webhooks (flipagent → caller), notifications (eBay →
	// flipagent → caller), key introspection. Boring but needed.
	{
		name: "flipagent_webhooks_register",
		description: webhooksRegisterDescription,
		inputSchema: webhooksRegisterInput,
		execute: webhooksRegisterExecute,
	},
	{
		name: "flipagent_webhooks_list",
		description: webhooksListDescription,
		inputSchema: webhooksListInput,
		execute: webhooksListExecute,
	},
	{
		name: "flipagent_webhooks_revoke",
		description: webhooksRevokeDescription,
		inputSchema: webhooksRevokeInput,
		execute: webhooksRevokeExecute,
	},
	{
		name: "flipagent_notifications_topics",
		description: notificationsTopicsDescription,
		inputSchema: notificationsTopicsInput,
		execute: notificationsTopicsExecute,
	},
	{
		name: "flipagent_notifications_destinations",
		description: notificationsDestinationsDescription,
		inputSchema: notificationsDestinationsInput,
		execute: notificationsDestinationsExecute,
	},
	{
		name: "flipagent_notifications_subscriptions_list",
		description: notificationsSubscriptionsListDescription,
		inputSchema: notificationsSubscriptionsListInput,
		execute: notificationsSubscriptionsListExecute,
	},
	{
		name: "flipagent_notifications_subscriptions_create",
		description: notificationsSubscriptionsCreateDescription,
		inputSchema: notificationsSubscriptionsCreateInput,
		execute: notificationsSubscriptionsCreateExecute,
	},
	{
		name: "flipagent_notifications_subscriptions_get",
		description: notificationsSubscriptionsGetDescription,
		inputSchema: notificationsSubscriptionsGetInput,
		execute: notificationsSubscriptionsGetExecute,
	},
	{
		name: "flipagent_notifications_subscriptions_delete",
		description: notificationsSubscriptionsDeleteDescription,
		inputSchema: notificationsSubscriptionsDeleteInput,
		execute: notificationsSubscriptionsDeleteExecute,
	},
	{
		name: "flipagent_notifications_recent",
		description: notificationsRecentDescription,
		inputSchema: notificationsRecentInput,
		execute: notificationsRecentExecute,
	},
	{
		name: "flipagent_keys_me",
		description: keysMeDescription,
		inputSchema: keysMeInput,
		execute: keysMeExecute,
	},

	// Generic browser primitives — direct DOM queries through the bridge
	// for cases the high-level tools don't cover (custom marketplaces, new
	// fields, selector tuning). 1st-class surface, not a fallback path.
	{
		name: "flipagent_browser_query",
		description: browserQueryDescription,
		inputSchema: browserQueryInput,
		execute: browserQueryExecute,
	},
];
