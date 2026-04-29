/**
 * Typed client for the flipagent API — `api.flipagent.dev`.
 *
 * One client, one API key, every namespace under `/v1/*`. Three groups:
 *
 *   Marketplace passthrough (eBay-shape data, future Amazon/Mercari):
 *     - `listings`, `sold`, `orders`, `inventory`, `fulfillment`,
 *       `finance`, `markets`
 *
 *   flipagent value-add (server-side, marketplace-agnostic):
 *     - `research` — market summary (distribution + optimal list price)
 *     - `evaluate` — single-listing judgment   (Decisions pillar)
 *     - `discover` — rank deals across a search (Overnight pillar)
 *     - `ship`     — forwarder quote + catalog  (Operations pillar)
 *     - `draft`    — recommend optimal listing for a (re)listing
 *     - `reprice`  — hold / drop / delist a sitting listing
 *     - `expenses` — append-only cost-side ledger (the bits eBay's Finances API doesn't see)
 *
 *   Escape hatch:
 *     - `http`     — typed get/post/put/delete for endpoints not yet wrapped
 */

import { type BuyOrderClient, createBuyOrderClient } from "./buy-order.js";
import { type CapabilitiesClient, createCapabilitiesClient } from "./capabilities.js";
import { createDiscoverClient, type DiscoverClient } from "./discover.js";
import { createDraftClient, type DraftClient } from "./draft.js";
import { createEvaluateClient, type EvaluateClient } from "./evaluate.js";
import { createExpensesClient, type ExpensesClient } from "./expenses.js";
import { createFinanceClient, type FinanceClient } from "./finance.js";
import { createForwarderClient, type ForwarderClient } from "./forwarder.js";
import { createFulfillmentClient, type FulfillmentClient } from "./fulfillment.js";
import { createHttp, type FlipagentHttp } from "./http.js";
import { createInventoryClient, type InventoryClient } from "./inventory.js";
import { createListingsClient, type ListingsClient } from "./listings.js";
import { createMarketsClient, type MarketsClient } from "./markets.js";
import { createMatchClient, type MatchClient } from "./match.js";
import { createRepriceClient, type RepriceClient } from "./reprice.js";
import { createResearchClient, type ResearchClient } from "./research.js";
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
	listings: ListingsClient;
	sold: SoldClient;
	/** eBay Buy Order API — REST when approved, bridge fallback otherwise. */
	buy: { order: BuyOrderClient };
	forwarder: ForwarderClient;
	inventory: InventoryClient;
	fulfillment: FulfillmentClient;
	finance: FinanceClient;
	markets: MarketsClient;
	research: ResearchClient;
	match: MatchClient;
	evaluate: EvaluateClient;
	discover: DiscoverClient;
	ship: ShipClient;
	draft: DraftClient;
	reprice: RepriceClient;
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
		listings: createListingsClient(http),
		sold: createSoldClient(http),
		buy: { order: createBuyOrderClient(http) },
		forwarder: createForwarderClient(http),
		inventory: createInventoryClient(http),
		fulfillment: createFulfillmentClient(http),
		finance: createFinanceClient(http),
		markets: createMarketsClient(http),
		research: createResearchClient(http),
		match: createMatchClient(http),
		evaluate: createEvaluateClient(http),
		discover: createDiscoverClient(http),
		ship: createShipClient(http),
		draft: createDraftClient(http),
		reprice: createRepriceClient(http),
		expenses: createExpensesClient(http),
		webhooks: createWebhooksClient(http),
		http,
	};
}

export type { BuyOrderClient, QuickCheckoutInput } from "./buy-order.js";
export type { CapabilitiesClient } from "./capabilities.js";
export type { DiscoverClient } from "./discover.js";
export type { DraftClient } from "./draft.js";
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
export type { MatchClient, MatchPoolResult } from "./match.js";
export { isDelegateResponse } from "./match.js";
export type { RepriceClient } from "./reprice.js";
export type { ResearchClient } from "./research.js";
export type { ShipClient, ShipProviderSummary, ShipProvidersResponse } from "./ship.js";
export type { SoldClient, SoldSearchParams } from "./sold.js";
export type { WebhooksClient } from "./webhooks.js";
