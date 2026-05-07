/**
 * `/v1/analytics/*` — seller traffic, standards, customer-service metrics.
 */

import { SellerStandards, ServiceMetricsResponse, TrafficReport } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { getSellerStandards, getServiceMetrics, getTrafficReport } from "../../services/analytics.js";
import { ebayMarketplaceId } from "../../services/shared/marketplace.js";
import { errorResponse, jsonResponse } from "../../utils/openapi.js";

export const analyticsRoute = new Hono();

const COMMON = { 401: errorResponse("Auth missing."), 502: errorResponse("Upstream eBay failed.") };

analyticsRoute.get(
	"/traffic",
	describeRoute({
		tags: ["Analytics"],
		summary: "Traffic report",
		responses: { 200: jsonResponse("Traffic.", TrafficReport), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const from = c.req.query("from") ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
		const to = c.req.query("to") ?? new Date().toISOString().slice(0, 10);
		const dimension = c.req.query("dimension");
		return c.json({
			...(await getTrafficReport(from, to, dimension, {
				apiKeyId: c.var.apiKey.id,
				marketplace: ebayMarketplaceId(),
			})),
		});
	},
);

analyticsRoute.get(
	"/standards",
	describeRoute({
		tags: ["Analytics"],
		summary: "Seller standards profile",
		responses: { 200: jsonResponse("Standards.", SellerStandards), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const cycle = (c.req.query("cycle") as "CURRENT" | "PROJECTED" | undefined) ?? "CURRENT";
		return c.json({
			...(await getSellerStandards(cycle, {
				apiKeyId: c.var.apiKey.id,
				marketplace: ebayMarketplaceId(),
			})),
		});
	},
);

analyticsRoute.get(
	"/service-metrics",
	describeRoute({
		tags: ["Analytics"],
		summary: "Customer-service metrics",
		responses: { 200: jsonResponse("Metrics.", ServiceMetricsResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) =>
		c.json({
			...(await getServiceMetrics({
				apiKeyId: c.var.apiKey.id,
				marketplace: ebayMarketplaceId(),
			})),
		}),
);
