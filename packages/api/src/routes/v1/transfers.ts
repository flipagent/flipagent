/**
 * `/v1/transfers` — sell/finances inter-account transfers.
 */

import { TransfersListResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { listTransfers } from "../../services/money/operations.js";
import { errorResponse, jsonResponse } from "../../utils/openapi.js";

export const transfersRoute = new Hono();

const COMMON = { 401: errorResponse("Auth missing."), 502: errorResponse("Upstream eBay failed.") };

transfersRoute.get(
	"/",
	describeRoute({
		tags: ["Money"],
		summary: "List transfers",
		responses: { 200: jsonResponse("Transfers.", TransfersListResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) =>
		c.json({
			...(await listTransfers(
				{ limit: Number(c.req.query("limit") ?? 50), offset: Number(c.req.query("offset") ?? 0) },
				{ apiKeyId: c.var.apiKey.id, marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID") },
			)),
		}),
);
