import { type MarketSummaryRequest, MarketSummaryRequest as ResearchSummaryInputSchema } from "@flipagent/types";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export { ResearchSummaryInputSchema as researchSummaryInput };

export const researchSummaryDescription =
	"Build a market summary for a SKU. Calls POST /v1/research/summary. Pass `comparables` (sold listings from /v1/buy/marketplace_insights/item_sales/search) and optionally `asks` (active listings from /v1/buy/browse/item_summary/search). Returns mean / median / IQR / sales-per-day plus EV-optimal list price when comparables carry duration data. The bundle the agent reuses across evaluate / discover / draft / reprice.";

export async function researchSummaryExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const client = getClient(config);
	try {
		return await client.research.summary(args as unknown as MarketSummaryRequest);
	} catch (err) {
		const e = toApiCallError(err, "/v1/research/summary");
		return { error: "research_summary_failed", status: e.status, message: e.message, url: e.url };
	}
}
