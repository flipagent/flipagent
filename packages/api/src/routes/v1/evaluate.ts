/**
 * `/v1/evaluate/*` — single-item judgment. flipagent's "should I buy
 * this listing?" surface. Wraps the local scoring services so all SDK
 * clients (TS today, future Python/Rust) get identical verdicts via
 * one HTTP call.
 *
 *   POST /v1/evaluate           — full deal verdict (rating + signals + landed cost)
 *   POST /v1/evaluate/signals   — fired signal detectors only (no verdict)
 *
 * Maps to the Decisions pillar on the marketing site (#01: numbers
 * decide, not vibes).
 */

import { EvaluateRequest, EvaluateResponse, EvaluateSignalsRequest, EvaluateSignalsResponse } from "@flipagent/types";
import type { ItemDetail, ItemSummary } from "@flipagent/types/ebay/buy";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { getCached, hashQuery, setCached } from "../../proxy/cache.js";
import { scrapeItemDetail } from "../../proxy/scrape.js";
import { evaluate, signalsFor } from "../../services/scoring/index.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const evaluateRoute = new Hono();

const ITEM_DETAIL_TTL_SEC = 60 * 60 * 4;

/**
 * Fetch `itemCreationDate` + `itemEndDate` for every comp/ask that's
 * missing them and merge into the summary. eBay's sold-search HTML and
 * Browse `item_summary/search` don't carry start dates — durations live
 * only on the per-item detail. We try the shared cache first (the
 * matcher's pass-2 already fetched detail for every survivor), then fall
 * back to a fresh scrape so per-listing duration is always available
 * even when comps come from a non-playground caller. Without this, the
 * hazard model can't compute and the recommendation goes dark.
 */
async function enrichWithDuration<T extends ItemSummary>(items: ReadonlyArray<T>): Promise<T[]> {
	const path = "/buy/browse/v1/item";
	return Promise.all(
		items.map(async (item) => {
			if (item.itemCreationDate && item.itemEndDate) return item;
			const legacyId = item.legacyItemId ?? item.itemId.replace(/^v1\|/, "").replace(/\|0$/, "");
			if (!/^\d{6,}$/.test(legacyId)) return item;
			const queryHash = hashQuery({ itemId: legacyId });

			let detail: ItemDetail | null = null;
			const cached = await getCached<ItemDetail>(path, queryHash).catch(() => null);
			if (cached) {
				detail = cached.body;
			} else {
				try {
					detail = await scrapeItemDetail(legacyId);
					if (detail) {
						await setCached(path, queryHash, detail, "scrape", ITEM_DETAIL_TTL_SEC).catch((err) =>
							console.error("[evaluate] cache set failed:", err),
						);
					}
				} catch {
					detail = null;
				}
			}
			if (!detail) return item;
			const merged = { ...item } as T;
			if (!merged.itemCreationDate && detail.itemCreationDate) {
				merged.itemCreationDate = detail.itemCreationDate;
			}
			if (!merged.itemEndDate && detail.itemEndDate) {
				merged.itemEndDate = detail.itemEndDate;
			}
			return merged;
		}),
	);
}

evaluateRoute.post(
	"/",
	describeRoute({
		tags: ["Evaluate"],
		summary: "Score a single listing as a flip opportunity",
		description:
			"Pass at least a handful of `opts.comps` for margin math; without them the verdict is `skip`. Set `opts.forwarder` to attach a US-domestic landed cost. ItemSummary inputs lack `description`, which lowers the confidence multiplier — pass an ItemDetail or override `opts.minConfidence` for a confident `buy`.",
		responses: {
			200: jsonResponse("Deal verdict.", EvaluateResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
			429: errorResponse("Rate limit exceeded."),
		},
	}),
	requireApiKey,
	tbBody(EvaluateRequest),
	async (c) => {
		const { item, opts } = c.req.valid("json");
		const enrichedComps = opts?.comps ? await enrichWithDuration(opts.comps) : undefined;
		const enrichedAsks = opts?.asks ? await enrichWithDuration(opts.asks) : undefined;
		const verdict = evaluate(item, {
			...opts,
			comps: enrichedComps,
			asks: enrichedAsks,
		});
		return c.json(verdict);
	},
);

evaluateRoute.post(
	"/signals",
	describeRoute({
		tags: ["Evaluate"],
		summary: "Run signal detectors over a listing (no verdict)",
		description:
			"Returns the hits from `under_median`, `ending_soon_low_watchers`, and `poor_title` detectors. `under_median` requires `comps`; the others run unconditionally. Use this when the agent wants raw evidence to feed a custom scoring policy.",
		responses: {
			200: jsonResponse("Fired signal hits.", EvaluateSignalsResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
			429: errorResponse("Rate limit exceeded."),
		},
	}),
	requireApiKey,
	tbBody(EvaluateSignalsRequest),
	async (c) => {
		const { item, comps } = c.req.valid("json");
		const signals = signalsFor(item, comps ?? []);
		return c.json({ signals });
	},
);
