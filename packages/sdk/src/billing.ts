/**
 * `client.billing.*` — Stripe checkout + customer portal session
 * URLs. These are session-cookie protected on the server, so most
 * SDK callers won't need them — they're here for completeness so
 * dashboard glue code can use the same client.
 */

import type { BillingCheckoutRequest, BillingCheckoutResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface BillingClient {
	checkout(body: BillingCheckoutRequest): Promise<BillingCheckoutResponse>;
	portal(): Promise<{ url: string }>;
}

export function createBillingClient(http: FlipagentHttp): BillingClient {
	return {
		checkout: (body) => http.post("/v1/billing/checkout", body),
		portal: () => http.post("/v1/billing/portal"),
	};
}
