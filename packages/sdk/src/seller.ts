/**
 * `client.seller.*` — `/v1/me/seller/*` ancillary read surfaces.
 * Selling-policy CRUD lives at `client.policies`.
 */

import type {
	PayoutPercentageUpdateRequest,
	PayoutSettings,
	RateTableShippingCostUpdate,
	RateTableV2Response,
	SalesTaxResponse,
	SellerAdvertisingEligibility,
	SellerKyc,
	SellerPaymentsProgram,
	SellerPrivilege,
	SellerSubscription,
} from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface SellerClient {
	privilege(): Promise<SellerPrivilege>;
	kyc(): Promise<SellerKyc>;
	subscription(): Promise<SellerSubscription>;
	paymentsProgram(): Promise<SellerPaymentsProgram>;
	advertisingEligibility(): Promise<SellerAdvertisingEligibility>;
	salesTax(country: string): Promise<SalesTaxResponse>;
	payoutSettings(): Promise<PayoutSettings>;
	updatePayoutPercentage(body: PayoutPercentageUpdateRequest): Promise<PayoutSettings>;
	rateTable(id: string): Promise<RateTableV2Response>;
	updateRateTableShippingCost(id: string, body: RateTableShippingCostUpdate): Promise<RateTableV2Response>;
}

export function createSellerClient(http: FlipagentHttp): SellerClient {
	return {
		privilege: () => http.get("/v1/me/seller/privilege"),
		kyc: () => http.get("/v1/me/seller/kyc"),
		subscription: () => http.get("/v1/me/seller/subscription"),
		paymentsProgram: () => http.get("/v1/me/seller/payments-program"),
		advertisingEligibility: () => http.get("/v1/me/seller/advertising-eligibility"),
		salesTax: (country) => http.get(`/v1/me/seller/sales-tax/${encodeURIComponent(country)}`),
		payoutSettings: () => http.get("/v1/me/seller/payout-settings"),
		updatePayoutPercentage: (body) => http.post("/v1/me/seller/payout-settings/update-percentage", body),
		rateTable: (id) => http.get(`/v1/me/seller/rate-tables/${encodeURIComponent(id)}`),
		updateRateTableShippingCost: (id, body) =>
			http.post(`/v1/me/seller/rate-tables/${encodeURIComponent(id)}/update-shipping-cost`, body),
	};
}
