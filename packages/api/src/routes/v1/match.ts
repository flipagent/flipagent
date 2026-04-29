/**
 * `/v1/match` — comparable curation. Given a candidate listing and a pool
 * of search results, returns each pool item bucketed as `match` or
 * `reject` with a one-line reason. The decision is LLM-driven — see
 * `services/match/matcher.ts` — which means we need:
 *
 *   - one of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY`
 *     (otherwise 503),
 *   - a detail-fetcher for the second pass; we route through the same
 *     scrape path that `/v1/buy/browse/item/:itemId` uses so the
 *     response cache absorbs warm hits.
 *
 * Run this BEFORE `/v1/research/summary` or `/v1/evaluate`. The strict
 * binary decision means there's no "borderline" pile to triage by hand
 * any more — the model has the candidate's full aspects + image and
 * commits to same-or-different.
 */

import { MatchDelegateResponse, MatchRequest, MatchResponse } from "@flipagent/types";
import type { ItemDetail, ItemSummary } from "@flipagent/types/ebay/buy";
import { Type } from "@sinclair/typebox";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { getItemDetail } from "../../services/listings/detail.js";
import { MatchUnavailableError, matchPool } from "../../services/match/index.js";
import { renderResultHeaders } from "../../services/shared/headers.js";
import { toLegacyId } from "../../utils/item-id.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const matchRoute = new Hono();

/**
 * Resolve an `ItemSummary` to a full `ItemDetail`. Routes through the
 * shared listings/detail service so cache + observation hooks line up
 * with `/v1/buy/browse/item/:itemId` and the watchlist scan worker.
 */
async function fetchDetailWithCache(item: ItemSummary): Promise<ItemDetail | null> {
	const itemId = toLegacyId(item);
	if (!itemId) return null;
	const result = await getItemDetail(itemId);
	return result?.body ?? null;
}

matchRoute.post(
	"/",
	describeRoute({
		tags: ["Match"],
		summary: "Bucket a pool of comparables as match / reject against a candidate",
		description:
			"LLM-driven classifier. Pass 1 batch-triages the pool by title + condition + price (with thumbnails when `useImages`). Pass 2 deep-verifies each survivor with full aspects + images. Strict — different model, finish, colour, condition, or missing accessories all become `reject`. Use the `match` bucket directly in `/v1/research/summary` and `/v1/evaluate`.",
		responses: {
			200: jsonResponse(
				"Two-bucket classification (`mode: hosted`) or a ready-to-run prompt for the caller's LLM (`mode: delegate`).",
				Type.Union([MatchResponse, MatchDelegateResponse]),
			),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
			429: errorResponse("Rate limit exceeded."),
			503: errorResponse("No LLM provider configured (ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY)."),
		},
	}),
	requireApiKey,
	tbBody(MatchRequest),
	async (c) => {
		const { candidate, pool, options } = c.req.valid("json");
		try {
			const outcome = await matchPool(candidate, pool, options ?? {}, { getDetail: fetchDetailWithCache });
			if (outcome.mode === "delegate") {
				c.header("X-Flipagent-Match-Mode", "delegate");
				return c.json(outcome.delegate);
			}
			renderResultHeaders(c, outcome.result);
			return c.json(outcome.result.body);
		} catch (err) {
			if (err instanceof MatchUnavailableError) {
				return c.json({ error: "match_unavailable", message: err.message }, 503);
			}
			const message = err instanceof Error ? err.message : String(err);
			return c.json({ error: "match_failed", message }, 502);
		}
	},
);
