/**
 * `/v1/reprice` — decide hold/drop/delist for a sitting listing. Pure
 * compute: caller passes the listing's current price + listed-at
 * timestamp + a fresh market thesis.
 *
 * Maps to the Operations pillar (#02) — keep listed inventory honest
 * against shifting markets.
 */

import { RepriceRequest, RepriceResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { reprice } from "../../services/scoring/index.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const repriceRoute = new Hono();

repriceRoute.post(
	"/",
	describeRoute({
		tags: ["Reprice"],
		summary: "Decide hold/drop/delist for a sitting listing",
		description:
			"Compares time elapsed since `listedAt` against `market.meanDaysToSell`. Defaults to 'hold' when the market lacks duration data (no model, don't bluff). Drop suggests a 5%/10% price cut depending on staleness; delist fires at >4× expected duration.",
		responses: {
			200: jsonResponse("Reprice decision.", RepriceResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
			429: errorResponse("Rate limit exceeded."),
		},
	}),
	requireApiKey,
	tbBody(RepriceRequest),
	async (c) => {
		const { market, state } = c.req.valid("json");
		const rec = reprice(market, state);
		return c.json(rec);
	},
);
