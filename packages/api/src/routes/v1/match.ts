/**
 * `/v1/match` — comp curation. Given a candidate listing and a pool
 * of search results, returns each pool item bucketed as `match` or
 * `reject` with a one-line reason. The decision is LLM-driven — see
 * `services/match/matcher.ts` — which means we need:
 *
 *   - one of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY`
 *     (otherwise 503),
 *   - a detail-fetcher for the second pass; we route through the same
 *     scrape path that `/v1/listings/:itemId` uses so the response
 *     cache absorbs warm hits.
 *
 * Run this BEFORE `/v1/research/thesis` or `/v1/evaluate`. The strict
 * binary verdict means there's no "borderline" pile to triage by hand
 * any more — the model has the candidate's full aspects + image and
 * commits to same-or-different.
 */

import type { ItemDetail, ItemSummary } from "@flipagent/types/ebay/buy";
import { MatchRequest, MatchResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { getCached, hashQuery, setCached } from "../../proxy/cache.js";
import { scrapeItemDetail } from "../../proxy/scrape.js";
import { matchPool, MatchUnavailableError } from "../../services/match/index.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const matchRoute = new Hono();

const ITEM_DETAIL_TTL_SEC = 60 * 60 * 4; // mirror /v1/listings/:itemId

/**
 * Match-result cache TTL. Match decisions key off (candidate, pool
 * itemIds, options) — same triple = same LLM verdict, no need to re-pay
 * the inference cost. Pool composition shifts as listings sell/expire,
 * so this stays modest. 2h matches the active-listings cache halflife.
 */
const MATCH_TTL_SEC = 60 * 60 * 2;

/**
 * Resolve an `ItemSummary` to a full `ItemDetail`. Reads / writes the
 * same response cache that `/v1/listings/:itemId` uses so a Match call
 * after Discover doesn't re-pay the scrape fee. Returns null when the
 * legacyItemId is missing or scrape fails.
 */
async function fetchDetailWithCache(item: ItemSummary): Promise<ItemDetail | null> {
	const itemId = item.legacyItemId ?? item.itemId.replace(/^v1\|/, "").replace(/\|0$/, "");
	if (!/^\d{6,}$/.test(itemId)) return null;
	const path = "/buy/browse/v1/item";
	const queryHash = hashQuery({ itemId });
	const cached = await getCached<ItemDetail>(path, queryHash).catch(() => null);
	if (cached) return cached.body;
	try {
		const body = await scrapeItemDetail(itemId);
		if (body) {
			await setCached(path, queryHash, body, "scrape", ITEM_DETAIL_TTL_SEC).catch((err) =>
				console.error("[match] cache set failed:", err),
			);
		}
		return body;
	} catch {
		return null;
	}
}

matchRoute.post(
	"/",
	describeRoute({
		tags: ["Match"],
		summary: "Bucket a pool of comps as match / reject against a candidate",
		description:
			"LLM-driven classifier. Pass 1 batch-triages the pool by title + condition + price (with thumbnails when `useImages`). Pass 2 deep-verifies each survivor with full aspects + images. Strict — different model, finish, colour, condition, or missing accessories all become `reject`. Use the `match` bucket directly in `/v1/research/thesis` and `/v1/evaluate`.",
		responses: {
			200: jsonResponse("Two-bucket classification.", MatchResponse),
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
		// Deterministic cache key: same candidate + same pool ids (order-
		// independent) + same useImages flag → same verdict. Pool ids are
		// sorted so the hash doesn't depend on caller list order.
		const poolIds = pool
			.map((p) => p.itemId)
			.sort()
			.join(",");
		const queryHash = hashQuery({
			candidate: candidate.itemId,
			pool: poolIds,
			useImages: options?.useImages ?? true,
		});
		const cached = await getCached<MatchResponse>("/v1/match", queryHash).catch(() => null);
		if (cached) {
			c.header("X-Flipagent-Source", `cache:${cached.source}`);
			c.header("X-Flipagent-Cached-At", cached.createdAt.toISOString());
			return c.json(cached.body);
		}
		try {
			const result = await matchPool(candidate, pool, options ?? {}, { getDetail: fetchDetailWithCache });
			await setCached("/v1/match", queryHash, result, "llm", MATCH_TTL_SEC).catch((err) =>
				console.error("[match] cache set failed:", err),
			);
			return c.json(result);
		} catch (err) {
			if (err instanceof MatchUnavailableError) {
				return c.json({ error: "match_unavailable", message: err.message }, 503);
			}
			const message = err instanceof Error ? err.message : String(err);
			return c.json({ error: "match_failed", message }, 502);
		}
	},
);
