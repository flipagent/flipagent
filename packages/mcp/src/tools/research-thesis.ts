import { ResearchThesisRequest as ResearchThesisInputSchema, type ResearchThesisRequest } from "@flipagent/types";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export { ResearchThesisInputSchema as researchThesisInput };

export const researchThesisDescription =
	"Build a market thesis for a SKU. Calls POST /v1/research/thesis. Pass `comps` (sold listings from /v1/sold/search) and optionally `asks` (active listings from /v1/listings/search). Returns mean / median / IQR / sales-per-day plus EV-optimal list price when comps carry duration data. The bundle the agent reuses across evaluate / discover / draft / reprice.";

export async function researchThesisExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const client = getClient(config);
	try {
		return await client.research.thesis(args as unknown as ResearchThesisRequest);
	} catch (err) {
		const e = toApiCallError(err, "/v1/research/thesis");
		return { error: "research_thesis_failed", status: e.status, message: e.message, url: e.url };
	}
}
