/**
 * `/v1/disputes/*` — returns + cases + cancellations + inquiries
 * unified into one resource with a `type` discriminator.
 */

import {
	DisputeActivityResponse,
	DisputeRespond,
	DisputeResponse,
	DisputesListQuery,
	DisputesListResponse,
} from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { getDispute, getDisputeActivity, listDisputes, respondToDispute } from "../../services/disputes/operations.js";
import { errorResponse, jsonResponse, paramsFor, tbBody, tbCoerce } from "../../utils/openapi.js";

export const disputesRoute = new Hono();

const COMMON = { 401: errorResponse("Auth."), 502: errorResponse("Upstream eBay failed.") };

disputesRoute.get(
	"/",
	describeRoute({
		tags: ["Disputes"],
		summary: "List disputes (returns + cases + cancellations + inquiries)",
		parameters: paramsFor("query", DisputesListQuery),
		responses: { 200: jsonResponse("Disputes.", DisputesListResponse), ...COMMON },
	}),
	requireApiKey,
	tbCoerce("query", DisputesListQuery),
	async (c) => {
		const q = c.req.valid("query");
		const r = await listDisputes(q, {
			apiKeyId: c.var.apiKey.id,
			marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
		});
		return c.json({
			disputes: r.disputes,
			limit: r.limit,
			offset: r.offset,
			source: "rest" as const,
		} satisfies DisputesListResponse);
	},
);

disputesRoute.get(
	"/:id",
	describeRoute({
		tags: ["Disputes"],
		summary: "Get a dispute (any type — auto-resolves by id)",
		responses: { 200: jsonResponse("Dispute.", DisputeResponse), 404: errorResponse("Not found."), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const dispute = await getDispute(c.req.param("id"), undefined, {
			apiKeyId: c.var.apiKey.id,
			marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
		});
		if (!dispute) return c.json({ error: "dispute_not_found", message: "No dispute." }, 404);
		return c.json(dispute);
	},
);

disputesRoute.get(
	"/:id/activity",
	describeRoute({
		tags: ["Disputes"],
		summary: "Activity history (payment disputes only)",
		description:
			"Returns the activity log for a payment dispute (open / contested / evidence-added / resolved). 404 when the id resolves to a return / case / cancellation / inquiry — eBay has no activity endpoint for those.",
		responses: {
			200: jsonResponse("Activity log.", DisputeActivityResponse),
			404: errorResponse("Dispute not found or not a payment dispute."),
			...COMMON,
		},
	}),
	requireApiKey,
	async (c) => {
		const result = await getDisputeActivity(c.req.param("id"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
		});
		if (!result) {
			return c.json(
				{
					error: "dispute_activity_unavailable",
					message: "Activity history is only available for payment disputes.",
				},
				404,
			);
		}
		return c.json({ ...result, source: "rest" as const });
	},
);

disputesRoute.post(
	"/:id/respond",
	describeRoute({
		tags: ["Disputes"],
		summary: "Respond to a dispute",
		responses: {
			200: jsonResponse("Updated dispute.", DisputeResponse),
			404: errorResponse("Not found."),
			...COMMON,
		},
	}),
	requireApiKey,
	tbBody(DisputeRespond),
	async (c) => {
		const dispute = await respondToDispute(c.req.param("id"), c.req.valid("json"), {
			apiKeyId: c.var.apiKey.id,
			marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
		});
		if (!dispute) return c.json({ error: "dispute_not_found", message: "No dispute." }, 404);
		return c.json(dispute);
	},
);
