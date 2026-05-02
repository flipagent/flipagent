/**
 * Server-side recommendations — flipagent's curated picks for the
 * api key based on history + live market signals.
 */

import { RecommendationsListQuery } from "@flipagent/types";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export { RecommendationsListQuery as recommendationsListInput };

export const recommendationsListDescription =
	"List flipagent's recommendations. GET /v1/recommendations. Filter by `kind` (sourcing|repricing|relisting|markdown) and `limit`. Each item carries the suggested action + the signals that triggered it.";

export async function recommendationsListExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.recommendations.list(args as Parameters<typeof client.recommendations.list>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/recommendations");
		return { error: "recommendations_list_failed", status: e.status, url: e.url, message: e.message };
	}
}
