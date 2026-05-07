/**
 * `/v1/policies/*` — selling policies (return | payment | fulfillment) +
 * rate-tables + custom policies (product-compliance / take-back) + transfer.
 *
 * One unified resource. eBay splits these across three sell/account
 * endpoints + sell/recommendation extras; flipagent normalizes.
 */

import {
	CustomPoliciesListResponse,
	CustomPolicyCreate,
	PoliciesListResponse,
	PoliciesSetupRequest,
	PoliciesSetupResponse,
	PolicyCreate,
	PolicyTransferRequest,
	type PolicyType,
	RateTablesListResponse,
} from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { getPolicyByName, listPolicies } from "../../services/policies.js";
import { createPolicy, deletePolicy, setupSellerPolicies, updatePolicy } from "../../services/policies-write.js";
import {
	createCustomPolicy,
	listCustomPolicies,
	listRateTables,
	transferFulfillmentPolicy,
} from "../../services/seller-account.js";
import { ebayMarketplaceId } from "../../services/shared/marketplace.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const policiesRoute = new Hono();

const POLICY_TYPES: ReadonlySet<string> = new Set(["return", "payment", "fulfillment"]);
const COMMON = { 401: errorResponse("Auth missing."), 502: errorResponse("Upstream eBay failed.") };

policiesRoute.get(
	"/",
	describeRoute({
		tags: ["Policies"],
		summary: "List all policies (return + payment + fulfillment)",
		responses: { 200: jsonResponse("Policies.", PoliciesListResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const r = await listPolicies(undefined, {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json({ policies: r.policies, limit: r.limit, offset: r.offset });
	},
);

policiesRoute.get(
	"/by-name",
	describeRoute({
		tags: ["Policies"],
		summary: "Look up a policy by exact name (idempotency helper)",
		description:
			"Wraps Sell Account `/sell/account/v1/{type}_policy/get_by_policy_name?marketplace_id=&name=`. Useful for scripts that want to check whether a named policy exists before creating it (avoid duplicates).",
		responses: { 200: { description: "Policy." }, 404: errorResponse("Not found."), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const type = c.req.query("type");
		const name = c.req.query("name");
		if (!type || !POLICY_TYPES.has(type) || !name) {
			return c.json({ error: "missing_params", message: "?type=return|payment|fulfillment&name=… required." }, 400);
		}
		const r = await getPolicyByName(type as PolicyType, name, {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		if (!r) return c.json({ error: "policy_not_found", message: `No ${type} policy named '${name}'.` }, 404);
		return c.json({ ...r });
	},
);

/* ----- /v1/policies/rate-tables -------------------------------------- */

policiesRoute.get(
	"/rate-tables",
	describeRoute({
		tags: ["Policies"],
		summary: "List shipping rate tables",
		responses: { 200: jsonResponse("Rate tables.", RateTablesListResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) =>
		c.json({
			...(await listRateTables({
				apiKeyId: c.var.apiKey.id,
				marketplace: ebayMarketplaceId(),
			})),
		}),
);

/* ----- /v1/policies/custom ------------------------------------------- */

policiesRoute.get(
	"/custom",
	describeRoute({
		tags: ["Policies"],
		summary: "List custom policies (product-compliance / take-back)",
		responses: { 200: jsonResponse("Custom policies.", CustomPoliciesListResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const type = c.req.query("type");
		return c.json({
			...(await listCustomPolicies(type, {
				apiKeyId: c.var.apiKey.id,
				marketplace: ebayMarketplaceId(),
			})),
		});
	},
);

policiesRoute.post(
	"/custom",
	describeRoute({
		tags: ["Policies"],
		summary: "Create a custom policy",
		responses: { 201: jsonResponse("Created.", CustomPolicyCreate), ...COMMON },
	}),
	requireApiKey,
	tbBody(CustomPolicyCreate),
	async (c) => {
		const body = c.req.valid("json");
		const created = await createCustomPolicy(body, {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json(created, 201);
	},
);

/* ----- /v1/policies/{id}/transfer ------------------------------------ */

policiesRoute.post(
	"/:id/transfer",
	describeRoute({
		tags: ["Policies"],
		summary: "Transfer a fulfillment policy to another seller",
		responses: { 200: { description: "Transferred." }, ...COMMON },
	}),
	requireApiKey,
	tbBody(PolicyTransferRequest),
	async (c) => {
		const body = c.req.valid("json");
		const r = await transferFulfillmentPolicy(c.req.param("id"), body.targetUsername, {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json(r);
	},
);

policiesRoute.post(
	"/",
	describeRoute({
		tags: ["Policies"],
		summary: "Create a return / payment / fulfillment policy",
		description:
			"Body discriminator `type` picks the right `/sell/account/v1/{type}_policy` POST. Each policy type uses different required fields (return needs `returnsAccepted`; fulfillment needs `handlingTimeDays` + at least one `shippingOptions[]`; payment needs `immediatePay`). Account must be opted into `SELLING_POLICY_MANAGEMENT` first (see `POST /v1/me/programs/opt-in`).",
		responses: { 201: jsonResponse("Created.", PolicyCreate), ...COMMON },
	}),
	requireApiKey,
	tbBody(PolicyCreate),
	async (c) => {
		const body = c.req.valid("json");
		const r = await createPolicy(body, {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json({ ...r }, 201);
	},
);

policiesRoute.post(
	"/setup",
	describeRoute({
		tags: ["Policies"],
		summary: "Atomically ensure return + payment + fulfillment policies exist",
		description:
			"One-shot setup tied to the user's actual preferences (returns yes/no + period + payer; handling time + shipping mode/service). Idempotent: re-uses existing policies on the seller account when present, only creates the missing ones. Returns the three ids ready to pass to `POST /v1/listings`. **Replaces hidden auto-create.** Earlier `/v1/listings` invented sane-looking defaults (free shipping, 30-day buyer-pays returns) on the seller's behalf — that silently lost real money. Now agents gather the few decisions from the user via MCP and POST them here once.",
		responses: { 200: jsonResponse("Policies ready.", PoliciesSetupResponse), ...COMMON },
	}),
	requireApiKey,
	tbBody(PoliciesSetupRequest),
	async (c) => {
		const body = c.req.valid("json");
		const r = await setupSellerPolicies(body, {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json(r, 200);
	},
);

policiesRoute.put(
	"/:type/:id",
	describeRoute({
		tags: ["Policies"],
		summary: "Replace one return / payment / fulfillment policy",
		responses: { 200: jsonResponse("Updated.", PolicyCreate), ...COMMON },
	}),
	requireApiKey,
	tbBody(PolicyCreate),
	async (c) => {
		const type = c.req.param("type");
		if (!POLICY_TYPES.has(type)) {
			return c.json({ error: "invalid_policy_type", message: "Use 'return', 'payment', or 'fulfillment'." }, 400);
		}
		const body = c.req.valid("json");
		const r = await updatePolicy(
			c.req.param("id"),
			{ ...body, type: type as PolicyType },
			{
				apiKeyId: c.var.apiKey.id,
				marketplace: ebayMarketplaceId(),
			},
		);
		return c.json({ ...r });
	},
);

policiesRoute.delete(
	"/:type/:id",
	describeRoute({
		tags: ["Policies"],
		summary: "Delete a return / payment / fulfillment policy",
		responses: { 200: { description: "Deleted." }, ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const type = c.req.param("type");
		if (!POLICY_TYPES.has(type)) {
			return c.json({ error: "invalid_policy_type", message: "Use 'return', 'payment', or 'fulfillment'." }, 400);
		}
		await deletePolicy(c.req.param("id"), type as PolicyType, {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json({ ok: true });
	},
);
