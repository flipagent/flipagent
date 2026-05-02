/**
 * `/v1/translate` — text translation (eBay Commerce Translation API).
 */

import { TranslateRequest, TranslateResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { translateText } from "../../services/translate.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const translateRoute = new Hono();

const COMMON = { 401: errorResponse("Auth missing."), 502: errorResponse("Upstream eBay failed.") };

translateRoute.post(
	"/",
	describeRoute({
		tags: ["Translate"],
		summary: "Translate text(s)",
		responses: { 200: jsonResponse("Translations.", TranslateResponse), ...COMMON },
	}),
	requireApiKey,
	tbBody(TranslateRequest),
	async (c) => c.json({ ...(await translateText(c.req.valid("json"))), source: "rest" as const }),
);
