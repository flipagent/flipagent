/**
 * `/v1/labels/*` — eBay-issued shipping labels (quote → buy → void).
 */

import { Label, LabelPurchaseRequest, LabelQuoteRequest, LabelQuoteResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { purchaseLabel, quoteLabel, voidLabel } from "../../services/labels.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const labelsRoute = new Hono();

const COMMON = { 401: errorResponse("Auth missing."), 502: errorResponse("Upstream eBay failed.") };

labelsRoute.post(
	"/quote",
	describeRoute({
		tags: ["Labels"],
		summary: "Get rate quotes for an eBay-issued shipping label",
		responses: { 200: jsonResponse("Quotes.", LabelQuoteResponse), ...COMMON },
	}),
	requireApiKey,
	tbBody(LabelQuoteRequest),
	async (c) => c.json({ ...(await quoteLabel(c.req.valid("json"), { apiKeyId: c.var.apiKey.id })) }),
);

labelsRoute.post(
	"/",
	describeRoute({
		tags: ["Labels"],
		summary: "Buy a shipping label from a quote",
		responses: { 201: jsonResponse("Label.", Label), ...COMMON },
	}),
	requireApiKey,
	tbBody(LabelPurchaseRequest),
	async (c) => c.json({ ...(await purchaseLabel(c.req.valid("json"), { apiKeyId: c.var.apiKey.id })) }, 201),
);

labelsRoute.delete(
	"/:id",
	describeRoute({
		tags: ["Labels"],
		summary: "Void a shipping label",
		responses: { 200: { description: "Voided." }, ...COMMON },
	}),
	requireApiKey,
	async (c) => c.json(await voidLabel(c.req.param("id"), { apiKeyId: c.var.apiKey.id })),
);
