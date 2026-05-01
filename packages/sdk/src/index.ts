/**
 * Typed client for the flipagent API — `api.flipagent.dev`.
 *
 * One client, one API key, every namespace under `/v1/*`. Three groups:
 *
 *   Marketplace passthrough (eBay-shape data, future Amazon/Mercari):
 *     - `search` — unified active+sold search (mode-discriminated)
 *     - `listings`, `sold` — direct mirror routes (eBay 1:1 paths)
 *     - `buy.order` — buy-side checkout (REST + bridge transports)
 *     - `inventory`, `fulfillment`, `finance`, `markets`, `forwarder`
 *
 *   flipagent value-add (server-side, marketplace-agnostic):
 *     - `evaluate` — single-listing judgment   (Decisions pillar)
 *     - `discover` — rank deals across a search (Overnight pillar)
 *     - `ship`     — forwarder quote + catalog  (Operations pillar)
 *     - `expenses` — append-only cost-side ledger (the bits eBay's Finances API doesn't see)
 *
 *   Escape hatch:
 *     - `http`     — typed get/post/put/delete for endpoints not yet wrapped
 */

import { type BuyOrderClient, createBuyOrderClient } from "./buy-order.js";
import { type CapabilitiesClient, createCapabilitiesClient } from "./capabilities.js";
import { createDiscoverClient, type DiscoverClient } from "./discover.js";
import { createEvaluateClient, type EvaluateClient } from "./evaluate.js";
import { createExpensesClient, type ExpensesClient } from "./expenses.js";
import { createFinanceClient, type FinanceClient } from "./finance.js";
import { createForwarderClient, type ForwarderClient } from "./forwarder.js";
import { createFulfillmentClient, type FulfillmentClient } from "./fulfillment.js";
import { createHttp, type FlipagentHttp } from "./http.js";
import { createInventoryClient, type InventoryClient } from "./inventory.js";
import { createListingsClient, type ListingsClient } from "./listings.js";
import { createMarketsClient, type MarketsClient } from "./markets.js";
import { createSearchClient, type SearchClient } from "./search.js";
import { createShipClient, type ShipClient } from "./ship.js";
import { createSoldClient, type SoldClient } from "./sold.js";
import { createWebhooksClient, type WebhooksClient } from "./webhooks.js";

export interface FlipagentClientOptions {
	/** flipagent API key (e.g. `fk_live_…`). Sent as `Authorization: Bearer <key>`. */
	apiKey: string;
	/** Override the flipagent base URL. Defaults to `https://api.flipagent.dev`. */
	baseUrl?: string;
	/** Inject a custom fetch implementation (tests, retries, logging). */
	fetch?: typeof globalThis.fetch;
}

export interface FlipagentClient {
	/** Agent's first call — which marketplaces / tools work right now. */
	capabilities: CapabilitiesClient;
	/** Unified search across active + sold — one call, mode-discriminated. */
	search: SearchClient;
	listings: ListingsClient;
	sold: SoldClient;
	/** eBay Buy Order API — REST and bridge are both first-class transports; selected per `selectTransport` + `?transport=` override. */
	buy: { order: BuyOrderClient };
	forwarder: ForwarderClient;
	inventory: InventoryClient;
	fulfillment: FulfillmentClient;
	finance: FinanceClient;
	markets: MarketsClient;
	evaluate: EvaluateClient;
	discover: DiscoverClient;
	ship: ShipClient;
	expenses: ExpensesClient;
	webhooks: WebhooksClient;
	/** Escape hatch for endpoints not yet wrapped above. */
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
		capabilities: createCapabilitiesClient(http),
		search: createSearchClient(http),
		listings: createListingsClient(http),
		sold: createSoldClient(http),
		buy: { order: createBuyOrderClient(http) },
		forwarder: createForwarderClient(http),
		inventory: createInventoryClient(http),
		fulfillment: createFulfillmentClient(http),
		finance: createFinanceClient(http),
		markets: createMarketsClient(http),
		evaluate: createEvaluateClient(http),
		discover: createDiscoverClient(http),
		ship: createShipClient(http),
		expenses: createExpensesClient(http),
		webhooks: createWebhooksClient(http),
		http,
	};
}

export type { BuyOrderClient, QuickCheckoutInput } from "./buy-order.js";
export type { CapabilitiesClient } from "./capabilities.js";
export type { DiscoverClient } from "./discover.js";
export { isBuyable } from "./discover.js";
export type { EvaluateClient } from "./evaluate.js";
export type { ExpensesClient, ExpensesSummaryParams } from "./expenses.js";
export type { FinanceClient } from "./finance.js";
export type { ForwarderClient } from "./forwarder.js";
export type { FulfillmentClient } from "./fulfillment.js";
export type { FlipagentHttp, RequestMethod } from "./http.js";
export { FlipagentApiError } from "./http.js";
export type { InventoryClient } from "./inventory.js";
export type { ListingSearchParams, ListingsClient } from "./listings.js";
export type { MarketsClient, PoliciesClient, TaxonomyClient } from "./markets.js";
export type { SearchClient, SearchParams } from "./search.js";
export type { ShipClient, ShipProviderSummary, ShipProvidersResponse } from "./ship.js";
export type { SoldClient, SoldSearchParams } from "./sold.js";
export type { WebhooksClient } from "./webhooks.js";
