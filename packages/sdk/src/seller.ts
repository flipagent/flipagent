/**
 * `client.seller.*` — `/v1/me/seller/*` ancillary read surfaces.
 * Selling-policy CRUD lives at `client.policies`.
 */

import type {
	SalesTaxResponse,
	SellerAdvertisingEligibility,
	SellerEligibility,
	SellerKyc,
	SellerPaymentsProgram,
	SellerPrivilege,
	SellerSubscription,
} from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface SellerClient {
	eligibility(): Promise<SellerEligibility>;
	privilege(): Promise<SellerPrivilege>;
	kyc(): Promise<SellerKyc>;
	subscription(): Promise<SellerSubscription>;
	paymentsProgram(): Promise<SellerPaymentsProgram>;
	advertisingEligibility(): Promise<SellerAdvertisingEligibility>;
	salesTax(country: string): Promise<SalesTaxResponse>;
}

export function createSellerClient(http: FlipagentHttp): SellerClient {
	return {
		eligibility: () => http.get("/v1/me/seller/eligibility"),
		privilege: () => http.get("/v1/me/seller/privilege"),
		kyc: () => http.get("/v1/me/seller/kyc"),
		subscription: () => http.get("/v1/me/seller/subscription"),
		paymentsProgram: () => http.get("/v1/me/seller/payments-program"),
		advertisingEligibility: () => http.get("/v1/me/seller/advertising-eligibility"),
		salesTax: (country) => http.get(`/v1/me/seller/sales-tax/${encodeURIComponent(country)}`),
	};
}
