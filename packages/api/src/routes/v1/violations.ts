/**
 * `/v1/violations` + `/v1/violations/summary` — sell/compliance, normalized.
 */

import {
	ViolationSuppressRequest,
	ViolationSuppressResponse,
	ViolationsListQuery,
	ViolationsListResponse,
	ViolationsSummaryResponse,
} from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { ebayMarketplaceId } from "../../services/shared/marketplace.js";
import { listViolations, summarizeViolations, suppressListingViolation } from "../../services/violations.js";
import { errorResponse, jsonResponse, paramsFor, tbBody, tbCoerce } from "../../utils/openapi.js";

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
			marketplace: ebayMarketplaceId(),
		});
		return c.json({ ...r });
	},
);

violationsRoute.post(
	"/suppress",
	describeRoute({
		tags: ["Violations"],
		summary: "Suppress a false-positive listing violation",
		description:
			"Wraps `/sell/compliance/v1/suppress_listing_violation`. Use when eBay flags a listing for a violation the seller can prove is incorrect (e.g. an aspects mismatch).",
		responses: {
			200: jsonResponse("Suppressed.", ViolationSuppressResponse),
			401: errorResponse("Auth missing."),
		},
	}),
	requireApiKey,
	tbBody(ViolationSuppressRequest),
	async (c) => {
		const body = c.req.valid("json");
		await suppressListingViolation(body, {
			apiKeyId: c.var.apiKey.id,
			marketplace: ebayMarketplaceId(),
		});
		return c.json({ ok: true } satisfies ViolationSuppressResponse);
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
			marketplace: ebayMarketplaceId(),
		});
		return c.json({
			violations: r.violations,
			limit: r.limit,
			offset: r.offset,
			...(r.total !== undefined ? { total: r.total } : {}),
		} satisfies ViolationsListResponse);
	},
);
