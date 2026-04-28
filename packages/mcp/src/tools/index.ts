import type { TSchema } from "@sinclair/typebox";
import type { Config } from "../config.js";
import { browserQueryDescription, browserQueryExecute, browserQueryInput } from "./browser-primitives.js";
import { discoverDealsDescription, discoverDealsExecute, discoverDealsInput } from "./discover-deals.js";
import { draftListingDescription, draftListingExecute, draftListingInput } from "./draft-listing.js";
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
import { ebaySearchDescription, ebaySearchExecute, ebaySearchInput } from "./ebay-search.js";
import { ebayListPayoutsDescription, ebayListPayoutsExecute, ebayListPayoutsInput } from "./ebay-sell-finance.js";
import {
	ebayListOrdersDescription,
	ebayListOrdersExecute,
	ebayListOrdersInput,
	ebayMarkShippedDescription,
	ebayMarkShippedExecute,
	ebayMarkShippedInput,
} from "./ebay-sell-fulfillment.js";
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
} from "./ebay-sell-inventory.js";
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
import { evaluateSignalsDescription, evaluateSignalsExecute, evaluateSignalsInput } from "./evaluate-signals.js";
import { expensesRecordDescription, expensesRecordExecute, expensesRecordInput } from "./expenses-record.js";
import { expensesSummaryDescription, expensesSummaryExecute, expensesSummaryInput } from "./expenses-summary.js";
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
	planetExpressPackagesDescription,
	planetExpressPackagesExecute,
	planetExpressPackagesInput,
} from "./forwarder-planetexpress.js";
import { matchPoolDescription, matchPoolExecute, matchPoolInput } from "./match-pool.js";
import { repriceListingDescription, repriceListingExecute, repriceListingInput } from "./reprice-listing.js";
import { researchThesisDescription, researchThesisExecute, researchThesisInput } from "./research-thesis.js";
import { shipProvidersDescription, shipProvidersExecute, shipProvidersInput } from "./ship-providers.js";
import { shipQuoteDescription, shipQuoteExecute, shipQuoteInput } from "./ship-quote.js";

export interface Tool {
	name: string;
	description: string;
	inputSchema: TSchema;
	execute: (config: Config, args: Record<string, unknown>) => Promise<unknown>;
}

export const tools: Tool[] = [
	// Discovery — read marketplace data
	{
		name: "ebay_search",
		description: ebaySearchDescription,
		inputSchema: ebaySearchInput,
		execute: ebaySearchExecute,
	},
	{
		name: "ebay_item_detail",
		description: ebayItemDetailDescription,
		inputSchema: ebayItemDetailInput,
		execute: ebayItemDetailExecute,
	},
	{
		name: "ebay_sold_search",
		description: ebaySoldSearchDescription,
		inputSchema: ebaySoldSearchInput,
		execute: ebaySoldSearchExecute,
	},
	{
		name: "ebay_taxonomy_default_id",
		description: ebayTaxonomyDefaultIdDescription,
		inputSchema: ebayTaxonomyDefaultIdInput,
		execute: ebayTaxonomyDefaultIdExecute,
	},
	{
		name: "ebay_taxonomy_suggest",
		description: ebayTaxonomySuggestDescription,
		inputSchema: ebayTaxonomySuggestInput,
		execute: ebayTaxonomySuggestExecute,
	},
	{
		name: "ebay_taxonomy_aspects",
		description: ebayTaxonomyAspectsDescription,
		inputSchema: ebayTaxonomyAspectsInput,
		execute: ebayTaxonomyAspectsExecute,
	},

	// flipagent management — capabilities is the agent's first call;
	// connect_status stays for back-compat (narrower view of the same data).
	{
		name: "flipagent_capabilities",
		description: flipagentCapabilitiesDescription,
		inputSchema: flipagentCapabilitiesInput,
		execute: flipagentCapabilitiesExecute,
	},
	{
		name: "flipagent_connect_status",
		description: flipagentConnectStatusDescription,
		inputSchema: flipagentConnectStatusInput,
		execute: flipagentConnectStatusExecute,
	},

	// Sell-side (user OAuth required; 401 not_connected if not bound)
	{
		name: "ebay_create_inventory_item",
		description: ebayCreateInventoryItemDescription,
		inputSchema: ebayCreateInventoryItemInput,
		execute: ebayCreateInventoryItemExecute,
	},
	{
		name: "ebay_create_offer",
		description: ebayCreateOfferDescription,
		inputSchema: ebayCreateOfferInput,
		execute: ebayCreateOfferExecute,
	},
	{
		name: "ebay_publish_offer",
		description: ebayPublishOfferDescription,
		inputSchema: ebayPublishOfferInput,
		execute: ebayPublishOfferExecute,
	},
	{
		name: "ebay_list_orders",
		description: ebayListOrdersDescription,
		inputSchema: ebayListOrdersInput,
		execute: ebayListOrdersExecute,
	},
	{
		name: "ebay_mark_shipped",
		description: ebayMarkShippedDescription,
		inputSchema: ebayMarkShippedInput,
		execute: ebayMarkShippedExecute,
	},
	{
		name: "ebay_list_payouts",
		description: ebayListPayoutsDescription,
		inputSchema: ebayListPayoutsInput,
		execute: ebayListPayoutsExecute,
	},

	// Research — market thesis (read-side feeder for every intelligence call)
	{
		name: "research_thesis",
		description: researchThesisDescription,
		inputSchema: researchThesisInput,
		execute: researchThesisExecute,
	},

	// Match — comp curation. Run BEFORE research_thesis / evaluate_listing
	// to drop similar-but-different SKUs (correct median).
	{
		name: "match_pool",
		description: matchPoolDescription,
		inputSchema: matchPoolInput,
		execute: matchPoolExecute,
	},

	// Evaluate — single-listing judgment (Decisions pillar)
	{
		name: "evaluate_listing",
		description: evaluateListingDescription,
		inputSchema: evaluateListingInput,
		execute: evaluateListingExecute,
	},
	{
		name: "evaluate_signals",
		description: evaluateSignalsDescription,
		inputSchema: evaluateSignalsInput,
		execute: evaluateSignalsExecute,
	},

	// Discover — rank deals across a search (Overnight pillar)
	{
		name: "discover_deals",
		description: discoverDealsDescription,
		inputSchema: discoverDealsInput,
		execute: discoverDealsExecute,
	},

	// Ship — forwarder quote + catalog (Operations pillar)
	{
		name: "ship_quote",
		description: shipQuoteDescription,
		inputSchema: shipQuoteInput,
		execute: shipQuoteExecute,
	},
	{
		name: "ship_providers",
		description: shipProvidersDescription,
		inputSchema: shipProvidersInput,
		execute: shipProvidersExecute,
	},

	// Draft + Reprice — sell-side recommendations (Operations pillar)
	{
		name: "draft_listing",
		description: draftListingDescription,
		inputSchema: draftListingInput,
		execute: draftListingExecute,
	},
	{
		name: "reprice_listing",
		description: repriceListingDescription,
		inputSchema: repriceListingInput,
		execute: repriceListingExecute,
	},

	// Expenses — append-only cost-side ledger (Finance phase, our half)
	{
		name: "expenses_record",
		description: expensesRecordDescription,
		inputSchema: expensesRecordInput,
		execute: expensesRecordExecute,
	},
	{
		name: "expenses_summary",
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
		name: "ebay_buy_item",
		description: ebayBuyItemDescription,
		inputSchema: ebayBuyItemInput,
		execute: ebayBuyItemExecute,
	},
	{
		name: "ebay_order_status",
		description: ebayOrderStatusDescription,
		inputSchema: ebayOrderStatusInput,
		execute: ebayOrderStatusExecute,
	},
	{
		name: "ebay_order_cancel",
		description: ebayOrderCancelDescription,
		inputSchema: ebayOrderCancelInput,
		execute: ebayOrderCancelExecute,
	},

	// Forwarders — Planet Express, MyUS, etc. Skeleton today; proves
	// the multi-service dispatcher across SDK/MCP/extension.
	{
		name: "planet_express_packages",
		description: planetExpressPackagesDescription,
		inputSchema: planetExpressPackagesInput,
		execute: planetExpressPackagesExecute,
	},

	// Generic browser primitives — fallback when high-level scrapers
	// fail, or for live DOM inspection during selector tuning.
	{
		name: "browser_query",
		description: browserQueryDescription,
		inputSchema: browserQueryInput,
		execute: browserQueryExecute,
	},
];
