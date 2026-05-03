import type { TSchema } from "@sinclair/typebox";
import type { Config } from "../config.js";
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
	cancellationCreateDescription,
	cancellationCreateExecute,
	cancellationCreateInput,
	cancellationEligibilityDescription,
	cancellationEligibilityExecute,
	cancellationEligibilityInput,
	disputesActivityDescription,
	disputesActivityExecute,
	disputesActivityInput,
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
import {
	evaluateJobDescription,
	evaluateJobExecute,
	evaluateJobInput,
	evaluateListingDescription,
	evaluateListingExecute,
	evaluateListingInput,
	evaluationPoolDescription,
	evaluationPoolExecute,
	evaluationPoolInput,
} from "./evaluate-listing.js";
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
	listingsPreviewFeesDescription,
	listingsPreviewFeesExecute,
	listingsPreviewFeesInput,
} from "./listings-fees.js";
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
	mePrograms_listDescription,
	mePrograms_listExecute,
	mePrograms_listInput,
	mePrograms_optInDescription,
	mePrograms_optInExecute,
	mePrograms_optInInput,
	mePrograms_optOutDescription,
	mePrograms_optOutExecute,
	mePrograms_optOutInput,
	meQuotaDescription,
	meQuotaExecute,
	meQuotaInput,
} from "./me-account.js";
import {
	mediaCreateUploadDescription,
	mediaCreateUploadExecute,
	mediaCreateUploadInput,
	mediaGetDescription,
	mediaGetExecute,
	mediaGetInput,
} from "./media.js";
import {
	conversationsListDescription,
	conversationsListExecute,
	conversationsListInput,
	conversationThreadDescription,
	conversationThreadExecute,
	conversationThreadInput,
	messagesSendDescription,
	messagesSendExecute,
	messagesSendInput,
} from "./messages.js";
import {
	notificationsConfigGetDescription,
	notificationsConfigGetExecute,
	notificationsConfigGetInput,
	notificationsConfigUpdateDescription,
	notificationsConfigUpdateExecute,
	notificationsConfigUpdateInput,
	notificationsDestinationsDescription,
	notificationsDestinationsExecute,
	notificationsDestinationsInput,
	notificationsPublicKeyDescription,
	notificationsPublicKeyExecute,
	notificationsPublicKeyInput,
	notificationsRecentDescription,
	notificationsRecentExecute,
	notificationsRecentInput,
	notificationsSubAddFilterDescription,
	notificationsSubAddFilterExecute,
	notificationsSubAddFilterInput,
	notificationsSubDeleteFilterDescription,
	notificationsSubDeleteFilterExecute,
	notificationsSubDeleteFilterInput,
	notificationsSubDisableDescription,
	notificationsSubDisableExecute,
	notificationsSubDisableInput,
	notificationsSubEnableDescription,
	notificationsSubEnableExecute,
	notificationsSubEnableInput,
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
	notificationsSubTestDescription,
	notificationsSubTestExecute,
	notificationsSubTestInput,
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
	recommendationsListDescription,
	recommendationsListExecute,
	recommendationsListInput,
} from "./recommendations.js";
import {
	sellerAdvertisingEligibilityDescription,
	sellerAdvertisingEligibilityExecute,
	sellerAdvertisingEligibilityInput,
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
import { transactionsListDescription, transactionsListExecute, transactionsListInput } from "./transactions.js";
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

/**
 * Toolsets group Phase 1 tools so the host (Claude Desktop, Cursor, etc.)
 * can load only the slice the user actually needs. Cursor caps at 40 MCP
 * tools total; Anthropic notes selection accuracy degrades past 30–50.
 * The default slice ("core") is kept under that ceiling. Opt in to others
 * via `FLIPAGENT_MCP_TOOLSETS=core,comms,forwarder,…`.
 *
 * Phase 1 scope only — non-Phase-1 toolsets (marketing, bulk, discovery)
 * have been removed from the V1 surface; the underlying SDK + service
 * wrappers stay in place at the API for re-introduction later.
 */
export type Toolset =
	| "core" // sourcing + decisions + buy + listing prereqs + sale fulfillment + finance — default-on
	| "comms" // messages + offers + disputes + feedback (post-sale buyer comms)
	| "forwarder" // /v1/forwarder/{provider}/* (Planet Express today)
	| "notifications" // webhooks + eBay platform notifications
	| "seller_account" // /v1/me/seller/* read-only diagnostics + sales tax
	| "admin"; // bridge surfaces, key introspection, status, browser primitive

export const ALL_TOOLSETS: readonly Toolset[] = [
	"core",
	"comms",
	"forwarder",
	"notifications",
	"seller_account",
	"admin",
] as const;

// `core` alone fits well under Cursor's 40-tool cap and Anthropic's 30–50 selection-accuracy
// guideline. Other toolsets are opt-in via FLIPAGENT_MCP_TOOLSETS.
export const DEFAULT_TOOLSETS: readonly Toolset[] = ["core"] as const;

export interface Tool {
	name: string;
	description: string;
	inputSchema: TSchema;
	execute: (config: Config, args: Record<string, unknown>) => Promise<unknown>;
	toolset: Toolset;
}

/**
 * Tool naming convention: `flipagent_<verb>_<resource>`, snake_case. Per
 * Anthropic's MCP-builder skill (anthropics/skills `mcp_best_practices.md`)
 * and the GitHub / Stripe / Slack reference servers, action-leading names
 * (`create_listing` over `listings_create`) align better with how LLMs plan
 * tool calls. The `flipagent_` prefix keeps names collision-free when other
 * MCP servers are loaded alongside. Marketplace stays a *parameter*, never
 * part of the tool name — Amazon/Mercari adapters reuse the same names.
 */
export const tools: Tool[] = [
	// ─── core ────────────────────────────────────────────────────────────
	// First-call discovery + key introspection.
	{
		name: "flipagent_get_capabilities",
		description: flipagentCapabilitiesDescription,
		inputSchema: flipagentCapabilitiesInput,
		execute: flipagentCapabilitiesExecute,
		toolset: "core",
	},
	{
		name: "flipagent_get_my_key",
		description: keysMeDescription,
		inputSchema: keysMeInput,
		execute: keysMeExecute,
		toolset: "core",
	},
	{
		name: "flipagent_get_quota",
		description: meQuotaDescription,
		inputSchema: meQuotaInput,
		execute: meQuotaExecute,
		toolset: "core",
	},
	{
		name: "flipagent_list_programs",
		description: mePrograms_listDescription,
		inputSchema: mePrograms_listInput,
		execute: mePrograms_listExecute,
		toolset: "core",
	},
	{
		name: "flipagent_opt_in_program",
		description: mePrograms_optInDescription,
		inputSchema: mePrograms_optInInput,
		execute: mePrograms_optInExecute,
		toolset: "core",
	},
	{
		name: "flipagent_opt_out_program",
		description: mePrograms_optOutDescription,
		inputSchema: mePrograms_optOutInput,
		execute: mePrograms_optOutExecute,
		toolset: "core",
	},

	// Sourcing — marketplace data (no eBay OAuth needed)
	{
		name: "flipagent_search_items",
		description: ebaySearchDescription,
		inputSchema: ebaySearchInput,
		execute: ebaySearchExecute,
		toolset: "core",
	},
	{
		name: "flipagent_get_item",
		description: ebayItemDetailDescription,
		inputSchema: ebayItemDetailInput,
		execute: ebayItemDetailExecute,
		toolset: "core",
	},
	{
		name: "flipagent_search_sold_items",
		description: ebaySoldSearchDescription,
		inputSchema: ebaySoldSearchInput,
		execute: ebaySoldSearchExecute,
		toolset: "core",
	},
	{
		name: "flipagent_list_categories",
		description: ebayTaxonomyDefaultIdDescription,
		inputSchema: ebayTaxonomyDefaultIdInput,
		execute: ebayTaxonomyDefaultIdExecute,
		toolset: "core",
	},
	{
		name: "flipagent_suggest_category",
		description: ebayTaxonomySuggestDescription,
		inputSchema: ebayTaxonomySuggestInput,
		execute: ebayTaxonomySuggestExecute,
		toolset: "core",
	},
	{
		name: "flipagent_list_category_aspects",
		description: ebayTaxonomyAspectsDescription,
		inputSchema: ebayTaxonomyAspectsInput,
		execute: ebayTaxonomyAspectsExecute,
		toolset: "core",
	},

	// Decisions + Operations — flipagent value-add
	{
		name: "flipagent_evaluate_item",
		description: evaluateListingDescription,
		inputSchema: evaluateListingInput,
		execute: evaluateListingExecute,
		toolset: "core",
	},
	{
		name: "flipagent_get_evaluate_job",
		description: evaluateJobDescription,
		inputSchema: evaluateJobInput,
		execute: evaluateJobExecute,
		toolset: "core",
	},
	{
		name: "flipagent_get_evaluation_pool",
		description: evaluationPoolDescription,
		inputSchema: evaluationPoolInput,
		execute: evaluationPoolExecute,
		toolset: "core",
	},
	{
		name: "flipagent_quote_shipping",
		description: shipQuoteDescription,
		inputSchema: shipQuoteInput,
		execute: shipQuoteExecute,
		toolset: "core",
	},

	// Buying (extension-bridged or REST passthrough)
	{
		name: "flipagent_create_purchase",
		description: ebayBuyItemDescription,
		inputSchema: ebayBuyItemInput,
		execute: ebayBuyItemExecute,
		toolset: "core",
	},
	{
		name: "flipagent_get_purchase",
		description: ebayOrderStatusDescription,
		inputSchema: ebayOrderStatusInput,
		execute: ebayOrderStatusExecute,
		toolset: "core",
	},
	{
		name: "flipagent_cancel_purchase",
		description: ebayOrderCancelDescription,
		inputSchema: ebayOrderCancelInput,
		execute: ebayOrderCancelExecute,
		toolset: "core",
	},
	{
		name: "flipagent_list_bids",
		description: bidsListDescription,
		inputSchema: bidsListInput,
		execute: bidsListExecute,
		toolset: "core",
	},
	{
		name: "flipagent_place_bid",
		description: bidsPlaceDescription,
		inputSchema: bidsPlaceInput,
		execute: bidsPlaceExecute,
		toolset: "core",
	},
	{
		name: "flipagent_list_biddable_listings",
		description: bidsEligibleListingsDescription,
		inputSchema: bidsEligibleListingsInput,
		execute: bidsEligibleListingsExecute,
		toolset: "core",
	},

	// Listing prereqs + listing CRUD (sell-side, eBay OAuth required)
	{
		name: "flipagent_create_media_upload",
		description: mediaCreateUploadDescription,
		inputSchema: mediaCreateUploadInput,
		execute: mediaCreateUploadExecute,
		toolset: "core",
	},
	{
		name: "flipagent_get_media",
		description: mediaGetDescription,
		inputSchema: mediaGetInput,
		execute: mediaGetExecute,
		toolset: "core",
	},
	{
		name: "flipagent_list_policies",
		description: policiesListDescription,
		inputSchema: policiesListInput,
		execute: policiesListExecute,
		toolset: "core",
	},
	{
		name: "flipagent_list_policies_by_type",
		description: policiesListByTypeDescription,
		inputSchema: policiesListByTypeInput,
		execute: policiesListByTypeExecute,
		toolset: "core",
	},
	{
		name: "flipagent_list_locations",
		description: locationsListDescription,
		inputSchema: locationsListInput,
		execute: locationsListExecute,
		toolset: "core",
	},
	{
		name: "flipagent_upsert_location",
		description: locationsUpsertDescription,
		inputSchema: locationsUpsertInput,
		execute: locationsUpsertExecute,
		toolset: "core",
	},
	{
		name: "flipagent_create_listing",
		description: ebayCreateInventoryItemDescription,
		inputSchema: ebayCreateInventoryItemInput,
		execute: ebayCreateInventoryItemExecute,
		toolset: "core",
	},
	{
		name: "flipagent_update_listing",
		description: ebayCreateOfferDescription,
		inputSchema: ebayCreateOfferInput,
		execute: ebayCreateOfferExecute,
		toolset: "core",
	},
	{
		name: "flipagent_relist_listing",
		description: ebayPublishOfferDescription,
		inputSchema: ebayPublishOfferInput,
		execute: ebayPublishOfferExecute,
		toolset: "core",
	},
	{
		name: "flipagent_preview_listing_fees",
		description: listingsPreviewFeesDescription,
		inputSchema: listingsPreviewFeesInput,
		execute: listingsPreviewFeesExecute,
		toolset: "core",
	},

	// Sale fulfillment + finance (sell-side)
	{
		name: "flipagent_list_sales",
		description: ebayListOrdersDescription,
		inputSchema: ebayListOrdersInput,
		execute: ebayListOrdersExecute,
		toolset: "core",
	},
	{
		name: "flipagent_ship_sale",
		description: ebayMarkShippedDescription,
		inputSchema: ebayMarkShippedInput,
		execute: ebayMarkShippedExecute,
		toolset: "core",
	},
	{
		name: "flipagent_list_payouts",
		description: ebayListPayoutsDescription,
		inputSchema: ebayListPayoutsInput,
		execute: ebayListPayoutsExecute,
		toolset: "core",
	},
	{
		name: "flipagent_list_transactions",
		description: transactionsListDescription,
		inputSchema: transactionsListInput,
		execute: transactionsListExecute,
		toolset: "core",
	},
	{
		name: "flipagent_list_recommendations",
		description: recommendationsListDescription,
		inputSchema: recommendationsListInput,
		execute: recommendationsListExecute,
		toolset: "core",
	},

	{
		name: "flipagent_get_ebay_connection",
		description: flipagentConnectStatusDescription,
		inputSchema: flipagentConnectStatusInput,
		execute: flipagentConnectStatusExecute,
		toolset: "core",
	},

	// ─── admin ───────────────────────────────────────────────────────────
	// Ship providers, location detail/delete + state toggles, browser DOM primitive escape hatch.
	{
		name: "flipagent_list_shipping_providers",
		description: shipProvidersDescription,
		inputSchema: shipProvidersInput,
		execute: shipProvidersExecute,
		toolset: "admin",
	},
	{
		name: "flipagent_get_location",
		description: locationsGetDescription,
		inputSchema: locationsGetInput,
		execute: locationsGetExecute,
		toolset: "admin",
	},
	{
		name: "flipagent_delete_location",
		description: locationsDeleteDescription,
		inputSchema: locationsDeleteInput,
		execute: locationsDeleteExecute,
		toolset: "admin",
	},
	{
		name: "flipagent_enable_location",
		description: locationsEnableDescription,
		inputSchema: locationsEnableInput,
		execute: locationsEnableExecute,
		toolset: "admin",
	},
	{
		name: "flipagent_disable_location",
		description: locationsDisableDescription,
		inputSchema: locationsDisableInput,
		execute: locationsDisableExecute,
		toolset: "admin",
	},
	{
		name: "flipagent_query_browser",
		description: browserQueryDescription,
		inputSchema: browserQueryInput,
		execute: browserQueryExecute,
		toolset: "admin",
	},

	// ─── comms (post-sale buyer turnover) ────────────────────────────────
	{
		name: "flipagent_list_conversations",
		description: conversationsListDescription,
		inputSchema: conversationsListInput,
		execute: conversationsListExecute,
		toolset: "comms",
	},
	{
		name: "flipagent_get_conversation_thread",
		description: conversationThreadDescription,
		inputSchema: conversationThreadInput,
		execute: conversationThreadExecute,
		toolset: "comms",
	},
	{
		name: "flipagent_send_message",
		description: messagesSendDescription,
		inputSchema: messagesSendInput,
		execute: messagesSendExecute,
		toolset: "comms",
	},
	{
		name: "flipagent_list_offers",
		description: offersListDescription,
		inputSchema: offersListInput,
		execute: offersListExecute,
		toolset: "comms",
	},
	{
		name: "flipagent_create_offer",
		description: offersCreateDescription,
		inputSchema: offersCreateInput,
		execute: offersCreateExecute,
		toolset: "comms",
	},
	{
		name: "flipagent_list_offer_eligible_listings",
		description: offersEligibleListingsDescription,
		inputSchema: offersEligibleListingsInput,
		execute: offersEligibleListingsExecute,
		toolset: "comms",
	},
	{
		name: "flipagent_respond_to_offer",
		description: offersRespondDescription,
		inputSchema: offersRespondInput,
		execute: offersRespondExecute,
		toolset: "comms",
	},
	{
		name: "flipagent_list_disputes",
		description: disputesListDescription,
		inputSchema: disputesListInput,
		execute: disputesListExecute,
		toolset: "comms",
	},
	{
		name: "flipagent_get_dispute",
		description: disputesGetDescription,
		inputSchema: disputesGetInput,
		execute: disputesGetExecute,
		toolset: "comms",
	},
	{
		name: "flipagent_respond_to_dispute",
		description: disputesRespondDescription,
		inputSchema: disputesRespondInput,
		execute: disputesRespondExecute,
		toolset: "comms",
	},
	{
		name: "flipagent_get_dispute_activity",
		description: disputesActivityDescription,
		inputSchema: disputesActivityInput,
		execute: disputesActivityExecute,
		toolset: "comms",
	},
	{
		name: "flipagent_check_cancellation_eligibility",
		description: cancellationEligibilityDescription,
		inputSchema: cancellationEligibilityInput,
		execute: cancellationEligibilityExecute,
		toolset: "comms",
	},
	{
		name: "flipagent_create_cancellation",
		description: cancellationCreateDescription,
		inputSchema: cancellationCreateInput,
		execute: cancellationCreateExecute,
		toolset: "comms",
	},
	{
		name: "flipagent_list_feedback",
		description: feedbackListDescription,
		inputSchema: feedbackListInput,
		execute: feedbackListExecute,
		toolset: "comms",
	},
	{
		name: "flipagent_list_awaiting_feedback",
		description: feedbackAwaitingDescription,
		inputSchema: feedbackAwaitingInput,
		execute: feedbackAwaitingExecute,
		toolset: "comms",
	},
	{
		name: "flipagent_leave_feedback",
		description: feedbackLeaveDescription,
		inputSchema: feedbackLeaveInput,
		execute: feedbackLeaveExecute,
		toolset: "comms",
	},

	// ─── forwarder ───────────────────────────────────────────────────────
	{
		name: "flipagent_refresh_forwarder",
		description: planetExpressPackagesDescription,
		inputSchema: planetExpressPackagesInput,
		execute: planetExpressPackagesExecute,
		toolset: "forwarder",
	},
	{
		name: "flipagent_list_forwarder_inventory",
		description: planetExpressInventoryDescription,
		inputSchema: planetExpressInventoryInput,
		execute: planetExpressInventoryExecute,
		toolset: "forwarder",
	},
	{
		name: "flipagent_request_package_photos",
		description: planetExpressPackagePhotosDescription,
		inputSchema: planetExpressPackagePhotosInput,
		execute: planetExpressPackagePhotosExecute,
		toolset: "forwarder",
	},
	{
		name: "flipagent_dispatch_package",
		description: planetExpressPackageDispatchDescription,
		inputSchema: planetExpressPackageDispatchInput,
		execute: planetExpressPackageDispatchExecute,
		toolset: "forwarder",
	},
	{
		name: "flipagent_link_package",
		description: planetExpressLinkDescription,
		inputSchema: planetExpressLinkInput,
		execute: planetExpressLinkExecute,
		toolset: "forwarder",
	},
	{
		name: "flipagent_get_forwarder_job",
		description: planetExpressJobStatusDescription,
		inputSchema: planetExpressJobStatusInput,
		execute: planetExpressJobStatusExecute,
		toolset: "forwarder",
	},

	// ─── seller_account (read-only diagnostics + sales tax) ──────────────
	{
		name: "flipagent_get_seller_privilege",
		description: sellerPrivilegeDescription,
		inputSchema: sellerPrivilegeInput,
		execute: sellerPrivilegeExecute,
		toolset: "seller_account",
	},
	{
		name: "flipagent_get_seller_kyc",
		description: sellerKycDescription,
		inputSchema: sellerKycInput,
		execute: sellerKycExecute,
		toolset: "seller_account",
	},
	{
		name: "flipagent_get_seller_subscription",
		description: sellerSubscriptionDescription,
		inputSchema: sellerSubscriptionInput,
		execute: sellerSubscriptionExecute,
		toolset: "seller_account",
	},
	{
		name: "flipagent_get_seller_payments_program",
		description: sellerPaymentsProgramDescription,
		inputSchema: sellerPaymentsProgramInput,
		execute: sellerPaymentsProgramExecute,
		toolset: "seller_account",
	},
	{
		name: "flipagent_get_seller_advertising_eligibility",
		description: sellerAdvertisingEligibilityDescription,
		inputSchema: sellerAdvertisingEligibilityInput,
		execute: sellerAdvertisingEligibilityExecute,
		toolset: "seller_account",
	},
	{
		name: "flipagent_get_seller_sales_tax",
		description: sellerSalesTaxDescription,
		inputSchema: sellerSalesTaxInput,
		execute: sellerSalesTaxExecute,
		toolset: "seller_account",
	},

	// ─── notifications + webhooks ────────────────────────────────────────
	{
		name: "flipagent_register_webhook",
		description: webhooksRegisterDescription,
		inputSchema: webhooksRegisterInput,
		execute: webhooksRegisterExecute,
		toolset: "notifications",
	},
	{
		name: "flipagent_list_webhooks",
		description: webhooksListDescription,
		inputSchema: webhooksListInput,
		execute: webhooksListExecute,
		toolset: "notifications",
	},
	{
		name: "flipagent_revoke_webhook",
		description: webhooksRevokeDescription,
		inputSchema: webhooksRevokeInput,
		execute: webhooksRevokeExecute,
		toolset: "notifications",
	},
	{
		name: "flipagent_list_notification_topics",
		description: notificationsTopicsDescription,
		inputSchema: notificationsTopicsInput,
		execute: notificationsTopicsExecute,
		toolset: "notifications",
	},
	{
		name: "flipagent_list_notification_destinations",
		description: notificationsDestinationsDescription,
		inputSchema: notificationsDestinationsInput,
		execute: notificationsDestinationsExecute,
		toolset: "notifications",
	},
	{
		name: "flipagent_list_notification_subscriptions",
		description: notificationsSubscriptionsListDescription,
		inputSchema: notificationsSubscriptionsListInput,
		execute: notificationsSubscriptionsListExecute,
		toolset: "notifications",
	},
	{
		name: "flipagent_create_notification_subscription",
		description: notificationsSubscriptionsCreateDescription,
		inputSchema: notificationsSubscriptionsCreateInput,
		execute: notificationsSubscriptionsCreateExecute,
		toolset: "notifications",
	},
	{
		name: "flipagent_get_notification_subscription",
		description: notificationsSubscriptionsGetDescription,
		inputSchema: notificationsSubscriptionsGetInput,
		execute: notificationsSubscriptionsGetExecute,
		toolset: "notifications",
	},
	{
		name: "flipagent_delete_notification_subscription",
		description: notificationsSubscriptionsDeleteDescription,
		inputSchema: notificationsSubscriptionsDeleteInput,
		execute: notificationsSubscriptionsDeleteExecute,
		toolset: "notifications",
	},
	{
		name: "flipagent_enable_notification_subscription",
		description: notificationsSubEnableDescription,
		inputSchema: notificationsSubEnableInput,
		execute: notificationsSubEnableExecute,
		toolset: "notifications",
	},
	{
		name: "flipagent_disable_notification_subscription",
		description: notificationsSubDisableDescription,
		inputSchema: notificationsSubDisableInput,
		execute: notificationsSubDisableExecute,
		toolset: "notifications",
	},
	{
		name: "flipagent_test_notification_subscription",
		description: notificationsSubTestDescription,
		inputSchema: notificationsSubTestInput,
		execute: notificationsSubTestExecute,
		toolset: "notifications",
	},
	{
		name: "flipagent_add_notification_filter",
		description: notificationsSubAddFilterDescription,
		inputSchema: notificationsSubAddFilterInput,
		execute: notificationsSubAddFilterExecute,
		toolset: "notifications",
	},
	{
		name: "flipagent_delete_notification_filter",
		description: notificationsSubDeleteFilterDescription,
		inputSchema: notificationsSubDeleteFilterInput,
		execute: notificationsSubDeleteFilterExecute,
		toolset: "notifications",
	},
	{
		name: "flipagent_get_notification_config",
		description: notificationsConfigGetDescription,
		inputSchema: notificationsConfigGetInput,
		execute: notificationsConfigGetExecute,
		toolset: "notifications",
	},
	{
		name: "flipagent_update_notification_config",
		description: notificationsConfigUpdateDescription,
		inputSchema: notificationsConfigUpdateInput,
		execute: notificationsConfigUpdateExecute,
		toolset: "notifications",
	},
	{
		name: "flipagent_get_notification_public_key",
		description: notificationsPublicKeyDescription,
		inputSchema: notificationsPublicKeyInput,
		execute: notificationsPublicKeyExecute,
		toolset: "notifications",
	},
	{
		name: "flipagent_list_recent_notifications",
		description: notificationsRecentDescription,
		inputSchema: notificationsRecentInput,
		execute: notificationsRecentExecute,
		toolset: "notifications",
	},
];

/**
 * Filter the registry by toolsets enabled for this MCP instance.
 * Pass `["*"]` to enable all. Default = `DEFAULT_TOOLSETS`.
 */
export function selectTools(enabled: readonly Toolset[] | readonly ["*"]): Tool[] {
	if (enabled.length === 1 && enabled[0] === "*") return tools;
	const set = new Set(enabled as readonly Toolset[]);
	return tools.filter((t) => set.has(t.toolset));
}
