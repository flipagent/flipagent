/**
 * `/v1/me/seller/*` — seller-account ancillary read surfaces.
 *
 * Mounted at `/me/seller` because everything here is about the
 * caller's seller-side state. Selling-policy CRUD is at `/v1/policies`.
 */

import {
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
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import {
	deleteSalesTax,
	getPayoutSettings,
	getRateTableV2,
	getSalesTax,
	getSellerAdvertisingEligibility,
	getSellerKyc,
	getSellerPaymentsProgram,
	getSellerPrivilege,
	getSellerSubscription,
	updatePayoutPercentage,
	updateRateTableShippingCost,
	upsertSalesTax,
} from "../../services/seller-account.js";
import { ebayMarketplaceId } from "../../services/shared/marketplace.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

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
	async (c) => c.json({ ...(await getSellerPrivilege({ apiKeyId: c.var.apiKey.id })) }),
);

sellerRoute.get(
	"/kyc",
	describeRoute({
		tags: ["Seller"],
		summary: "KYC status",
		responses: { 200: jsonResponse("KYC.", SellerKyc), ...COMMON },
	}),
	requireApiKey,
	async (c) => c.json({ ...(await getSellerKyc({ apiKeyId: c.var.apiKey.id })) }),
);

sellerRoute.get(
	"/subscription",
	describeRoute({
		tags: ["Seller"],
		summary: "Program opt-ins",
		responses: { 200: jsonResponse("Subscriptions.", SellerSubscription), ...COMMON },
	}),
	requireApiKey,
	async (c) => c.json({ ...(await getSellerSubscription({ apiKeyId: c.var.apiKey.id })) }),
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
				marketplace: ebayMarketplaceId(),
			})),
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
				marketplace: ebayMarketplaceId(),
			})),
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
		}),
);

sellerRoute.put(
	"/sales-tax/:country/:jurisdiction",
	describeRoute({
		tags: ["Seller"],
		summary: "Set sales-tax rate for one jurisdiction",
		description:
			"Wraps `PUT /sell/account/v1/sales_tax/{country}/{jurisdictionId}`. Body: `{ salesTaxPercentage: number, shippingAndHandlingTaxed?: boolean }`. Replaces any existing rate for that jurisdiction.",
		responses: { 200: { description: "Saved." }, ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const body = (await c.req.json()) as { salesTaxPercentage: number; shippingAndHandlingTaxed?: boolean };
		await upsertSalesTax(c.req.param("country"), c.req.param("jurisdiction"), body, { apiKeyId: c.var.apiKey.id });
		return c.json({ ok: true });
	},
);

sellerRoute.delete(
	"/sales-tax/:country/:jurisdiction",
	describeRoute({
		tags: ["Seller"],
		summary: "Delete a sales-tax rate",
		responses: { 200: { description: "Deleted." }, ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		await deleteSalesTax(c.req.param("country"), c.req.param("jurisdiction"), { apiKeyId: c.var.apiKey.id });
		return c.json({ ok: true });
	},
);

/* --------- Sell Account v2 payout settings --------- */

sellerRoute.get(
	"/payout-settings",
	describeRoute({
		tags: ["Seller"],
		summary: "Read payout settings (v2)",
		description:
			"Wraps `GET /sell/account/v2/payout_settings`. Schedule + linked banks + percentage split. Pass-through under `raw` because eBay's shape is rich and rarely-used.",
		responses: { 200: jsonResponse("Payout settings.", PayoutSettings), ...COMMON },
	}),
	requireApiKey,
	async (c) => c.json({ ...(await getPayoutSettings({ apiKeyId: c.var.apiKey.id })) }),
);

sellerRoute.post(
	"/payout-settings/update-percentage",
	describeRoute({
		tags: ["Seller"],
		summary: "Update payout-percentage split (v2)",
		description:
			"Wraps `POST /sell/account/v2/payout_settings/update_percentage`. Body shape: pass through eBay's request via `{ raw: ... }`.",
		responses: { 200: jsonResponse("Updated.", PayoutSettings), ...COMMON },
	}),
	requireApiKey,
	tbBody(PayoutPercentageUpdateRequest),
	async (c) => {
		const body = c.req.valid("json");
		const r = await updatePayoutPercentage((body.raw as Record<string, unknown>) ?? {}, {
			apiKeyId: c.var.apiKey.id,
		});
		return c.json({ raw: r.raw });
	},
);

/* --------- Sell Account v2 rate-table read + cost patch --------- */

sellerRoute.get(
	"/rate-tables/:id",
	describeRoute({
		tags: ["Seller"],
		summary: "Read a rate-table's full contents (v2)",
		description: "Wraps `GET /sell/account/v2/rate_table/{id}`. Returns regions + costs verbatim under `raw`.",
		responses: { 200: jsonResponse("Rate table.", RateTableV2Response), ...COMMON },
	}),
	requireApiKey,
	async (c) => c.json({ ...(await getRateTableV2(c.req.param("id"), { apiKeyId: c.var.apiKey.id })) }),
);

sellerRoute.post(
	"/rate-tables/:id/update-shipping-cost",
	describeRoute({
		tags: ["Seller"],
		summary: "Patch a rate-table's shipping cost for one region",
		description:
			"Wraps `POST /sell/account/v2/rate_table/{id}/update_shipping_cost`. Body: pass eBay's request through `{ raw: ... }`.",
		responses: { 200: jsonResponse("Updated.", RateTableV2Response), ...COMMON },
	}),
	requireApiKey,
	tbBody(RateTableShippingCostUpdate),
	async (c) => {
		const body = c.req.valid("json");
		const r = await updateRateTableShippingCost(c.req.param("id"), (body.raw as Record<string, unknown>) ?? {}, {
			apiKeyId: c.var.apiKey.id,
		});
		return c.json({ id: c.req.param("id"), raw: r.raw });
	},
);
