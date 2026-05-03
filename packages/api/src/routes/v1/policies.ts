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
	PolicyTransferRequest,
	type PolicyType,
	RateTablesListResponse,
} from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { getPolicyByName, listPolicies } from "../../services/policies.js";
import {
	createCustomPolicy,
	listCustomPolicies,
	listRateTables,
	transferFulfillmentPolicy,
} from "../../services/seller-account.js";
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
			marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
		});
		return c.json({ policies: r.policies, limit: r.limit, offset: r.offset, source: "rest" as const });
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
			marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
		});
		if (!r) return c.json({ error: "policy_not_found", message: `No ${type} policy named '${name}'.` }, 404);
		return c.json({ ...r, source: "rest" as const });
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
				marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
			})),
			source: "rest" as const,
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
				marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
			})),
			source: "rest" as const,
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
			marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
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
			marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
		});
		return c.json(r);
	},
);

policiesRoute.get(
	"/:type",
	describeRoute({
		tags: ["Policies"],
		summary: "List policies of a specific type",
		responses: {
			200: jsonResponse("Policies.", PoliciesListResponse),
			400: errorResponse("Invalid policy type."),
			...COMMON,
		},
	}),
	requireApiKey,
	async (c) => {
		const type = c.req.param("type");
		if (!POLICY_TYPES.has(type)) {
			return c.json({ error: "invalid_policy_type", message: "Use 'return', 'payment', or 'fulfillment'." }, 400);
		}
		const r = await listPolicies(type as PolicyType, {
			apiKeyId: c.var.apiKey.id,
			marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
		});
		return c.json({ policies: r.policies, limit: r.limit, offset: r.offset, source: "rest" as const });
	},
);
