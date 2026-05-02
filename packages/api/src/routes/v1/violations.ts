/**
 * `/v1/violations` + `/v1/violations/summary` — sell/compliance, normalized.
 */

import { ViolationsListQuery, ViolationsListResponse, ViolationsSummaryResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { listViolations, summarizeViolations } from "../../services/violations.js";
import { errorResponse, jsonResponse, paramsFor, tbCoerce } from "../../utils/openapi.js";

export const violationsRoute = new Hono();

violationsRoute.get(
	"/summary",
	describeRoute({
		tags: ["Violations"],
		summary: "Aggregate violation counts by complianceType",
		responses: {
			200: jsonResponse("Summary.", ViolationsSummaryResponse),
			401: errorResponse("Auth missing."),
		},
	}),
	requireApiKey,
	async (c) => {
		const r = await summarizeViolations({
			apiKeyId: c.var.apiKey.id,
			marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
		});
		return c.json({ ...r, source: "rest" as const });
	},
);

violationsRoute.get(
	"/",
	describeRoute({
		tags: ["Violations"],
		summary: "List listing violations",
		parameters: paramsFor("query", ViolationsListQuery),
		responses: {
			200: jsonResponse("Violations.", ViolationsListResponse),
			401: errorResponse("Auth missing."),
		},
	}),
	requireApiKey,
	tbCoerce("query", ViolationsListQuery),
	async (c) => {
		const q = c.req.valid("query");
		const r = await listViolations(q, {
			apiKeyId: c.var.apiKey.id,
			marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID"),
		});
		return c.json({
			violations: r.violations,
			limit: r.limit,
			offset: r.offset,
			...(r.total !== undefined ? { total: r.total } : {}),
			source: "rest" as const,
		} satisfies ViolationsListResponse);
	},
);
