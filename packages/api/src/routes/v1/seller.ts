/**
 * `/v1/me/seller/*` — seller-account ancillary read surfaces.
 *
 * Mounted at `/me/seller` because everything here is about the
 * caller's seller-side state. Selling-policy CRUD is at `/v1/policies`.
 */

import {
	SalesTaxResponse,
	SellerAdvertisingEligibility,
	SellerKyc,
	SellerPaymentsProgram,
	SellerPrivilege,
	SellerSubscription,
} from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import {
	getSalesTax,
	getSellerAdvertisingEligibility,
	getSellerKyc,
	getSellerPaymentsProgram,
	getSellerPrivilege,
	getSellerSubscription,
} from "../../services/seller-account.js";
import { errorResponse, jsonResponse } from "../../utils/openapi.js";

export const sellerRoute = new Hono();

const COMMON = { 401: errorResponse("Auth missing."), 502: errorResponse("Upstream eBay failed.") };

// `/v1/seller/eligibility` removed — wrapped a non-existent eBay
// endpoint (`/sell/account/v1/eligibility` 404s in every variant).
// Use `/v1/seller/advertising-eligibility` for ad-program signal,
// `/v1/me/programs` for opted-in programs, or `/v1/seller/privilege`
// for selling-limit privilege.

sellerRoute.get(
	"/privilege",
	describeRoute({
		tags: ["Seller"],
		summary: "Selling privileges + limits",
		responses: { 200: jsonResponse("Privilege.", SellerPrivilege), ...COMMON },
	}),
	requireApiKey,
	async (c) => c.json({ ...(await getSellerPrivilege({ apiKeyId: c.var.apiKey.id })), source: "rest" as const }),
);

sellerRoute.get(
	"/kyc",
	describeRoute({
		tags: ["Seller"],
		summary: "KYC status",
		responses: { 200: jsonResponse("KYC.", SellerKyc), ...COMMON },
	}),
	requireApiKey,
	async (c) => c.json({ ...(await getSellerKyc({ apiKeyId: c.var.apiKey.id })), source: "rest" as const }),
);

sellerRoute.get(
	"/subscription",
	describeRoute({
		tags: ["Seller"],
		summary: "Program opt-ins",
		responses: { 200: jsonResponse("Subscriptions.", SellerSubscription), ...COMMON },
	}),
	requireApiKey,
	async (c) => c.json({ ...(await getSellerSubscription({ apiKeyId: c.var.apiKey.id })), source: "rest" as const }),
);

sellerRoute.get(
	"/payments-program",
	describeRoute({
		tags: ["Seller"],
		summary: "Managed payments status",
		responses: { 200: jsonResponse("Status.", SellerPaymentsProgram), ...COMMON },
	}),
	requireApiKey,
	async (c) =>
		c.json({
			...(await getSellerPaymentsProgram({
				apiKeyId: c.var.apiKey.id,
				marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
			})),
			source: "rest" as const,
		}),
);

sellerRoute.get(
	"/advertising-eligibility",
	describeRoute({
		tags: ["Seller"],
		summary: "Promoted-listings eligibility",
		responses: { 200: jsonResponse("Eligibility.", SellerAdvertisingEligibility), ...COMMON },
	}),
	requireApiKey,
	async (c) =>
		c.json({
			...(await getSellerAdvertisingEligibility({
				apiKeyId: c.var.apiKey.id,
				marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
			})),
			source: "rest" as const,
		}),
);

sellerRoute.get(
	"/sales-tax/:country",
	describeRoute({
		tags: ["Seller"],
		summary: "Sales-tax table for a country",
		responses: { 200: jsonResponse("Sales tax.", SalesTaxResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) =>
		c.json({
			...(await getSalesTax(c.req.param("country"), { apiKeyId: c.var.apiKey.id })),
			source: "rest" as const,
		}),
);
