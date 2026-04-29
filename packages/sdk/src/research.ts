/**
 * `client.research.*` — market summary + recovery probability.
 *
 *   summary              — distribution stats (+ optional EV-optimal list price)
 *   recoveryProbability  — "will I recover cost basis + min net within N days?"
 *
 * The bundle the agent computes once per SKU and reuses across
 * `evaluate`, `discover`, `draft`, `reprice`.
 */

import type { MarketSummaryRequest, MarketSummaryResponse, RecoveryRequest, RecoveryResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface ResearchClient {
	summary(req: MarketSummaryRequest): Promise<MarketSummaryResponse>;
	recoveryProbability(req: RecoveryRequest): Promise<RecoveryResponse>;
}

export function createResearchClient(http: FlipagentHttp): ResearchClient {
	return {
		summary: (req) => http.post("/v1/research/summary", req),
		recoveryProbability: (req) => http.post("/v1/research/recovery_probability", req),
	};
}
