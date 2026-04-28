/**
 * `client.research.*` — market thesis. Distribution stats + (optional)
 * EV-optimal list price for a SKU. The bundle the agent computes once
 * per SKU and reuses across `evaluate`, `discover`, `draft`, `reprice`.
 */

import type { ResearchThesisRequest, ResearchThesisResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface ResearchClient {
	thesis(req: ResearchThesisRequest): Promise<ResearchThesisResponse>;
}

export function createResearchClient(http: FlipagentHttp): ResearchClient {
	return {
		thesis: (req) => http.post("/v1/research/thesis", req),
	};
}
