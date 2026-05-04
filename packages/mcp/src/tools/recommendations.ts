/**
 * Server-side recommendations — flipagent's curated picks for the
 * api key based on history + live market signals.
 */

import { RecommendationsListQuery } from "@flipagent/types";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

export { RecommendationsListQuery as recommendationsListInput };

export const recommendationsListDescription =
	'List flipagent\'s curated recommendations for the connected seller (server-computed from history + live market signals). Calls GET /v1/recommendations. **When to use** — surface "what should I do today" actions: items to source, listings to re-price, stale listings to relist, candidates for markdown campaigns. **Inputs** — optional `kind` filter (`sourcing | repricing | relisting | markdown`), pagination `limit`. **Output** — `{ recommendations: [{ id, kind, action, signals: [...], suggestedTargets, createdAt }] }`. **Prereqs** — eBay seller account connected (`/v1/connect/ebay`); recommendations need history. On 401 the response carries `next_action` with the connect URL. **Example** — `{ kind: "repricing", limit: 10 }` for the 10 most-overdue price tweaks.';

export async function recommendationsListExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.recommendations.list(args as Parameters<typeof client.recommendations.list>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "recommendations_list_failed", "/v1/recommendations");
	}
}
