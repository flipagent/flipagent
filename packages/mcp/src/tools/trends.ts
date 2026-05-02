/**
 * Trends — server-computed listing-velocity signals. Use to bias
 * sourcing toward categories that are heating up.
 */

import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export const trendsCategoriesInput = Type.Object({});

export const trendsCategoriesDescription =
	"List categories trending over the last hour vs the prior 7-day baseline. GET /v1/trends/categories. Each row carries `categoryId`, `currentHourCount`, `weeklyBaselineHourly`, `zScore`, `asOf`. High z-score = abnormal listing activity worth investigating with `flipagent_items_search` on that category.";

export async function trendsCategoriesExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.trends.categories();
	} catch (err) {
		const e = toApiCallError(err, "/v1/trends/categories");
		return { error: "trends_categories_failed", status: e.status, url: e.url, message: e.message };
	}
}
