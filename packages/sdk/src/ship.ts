/**
 * `client.ship.*` — forwarder + landed cost. flipagent's Operations
 * pillar. Quote total delivered cost (item + ship + forwarder + tax)
 * or list available forwarders.
 */

import type { LandedCostBreakdown, ShipQuoteRequest } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface ShipProviderSummary {
	id: string;
	name: string;
	originState: string;
	handlingCents: number;
	perExtraItemCents: number;
	consolidationCents: number;
	dimDivisor: number;
	defaultService: string;
	supportedServices: string[];
	notes: string[];
}

export interface ShipProvidersResponse {
	providers: ShipProviderSummary[];
}

export interface ShipClient {
	quote(req: ShipQuoteRequest): Promise<LandedCostBreakdown>;
	providers(): Promise<ShipProvidersResponse>;
}

export function createShipClient(http: FlipagentHttp): ShipClient {
	return {
		quote: (req) => http.post("/v1/ship/quote", req),
		providers: () => http.get("/v1/ship/providers"),
	};
}
