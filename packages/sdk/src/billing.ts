/**
 * `client.billing.*` — subscription checkout, customer portal, and
 * auto-recharge configuration.
 *
 * Auto-recharge fires from the api middleware (no manual / "buy
 * credits now" entry point); the SDK exposes the **config** surface
 * + the per-tier price catalog the dashboard renders the form against.
 *
 * All session-cookie protected on the server, so SDK callers usually
 * authenticate via the same `flipagent.dev` session that the
 * dashboard runs under.
 */

import type {
	BillingAutoRechargeConfig,
	BillingAutoRechargeUpdateRequest,
	BillingCheckoutRequest,
	BillingCheckoutResponse,
	BillingHistoryResponse,
	BillingTopUpQuotesResponse,
} from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface BillingClient {
	checkout(body: BillingCheckoutRequest): Promise<BillingCheckoutResponse>;
	portal(): Promise<{ url: string }>;
	/** Subscription invoices + top-up receipts, newest-first. */
	invoices(): Promise<BillingHistoryResponse>;
	autoRecharge: {
		/** Per-amount price quotes at the caller's current tier. */
		quote(): Promise<BillingTopUpQuotesResponse>;
		get(): Promise<BillingAutoRechargeConfig>;
		set(body: BillingAutoRechargeUpdateRequest): Promise<BillingAutoRechargeConfig>;
	};
}

export function createBillingClient(http: FlipagentHttp): BillingClient {
	return {
		checkout: (body) => http.post("/v1/billing/checkout", body),
		portal: () => http.post("/v1/billing/portal"),
		invoices: () => http.get("/v1/billing/invoices"),
		autoRecharge: {
			quote: () => http.get("/v1/billing/quote"),
			get: () => http.get("/v1/billing/auto-recharge"),
			set: (body) => http.put("/v1/billing/auto-recharge", body),
		},
	};
}
