import type { Tool } from "../registry.js";
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
} from "../seller.js";

// /v1/me/seller/* read-only diagnostics + sales tax.
export const sellerAccountTools: Tool[] = [
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
];
