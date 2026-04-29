/**
 * `client.research.*` — market thesis + recovery probability.
 *
 *   thesis              — distribution stats (+ optional EV-optimal list price)
 *   recoveryProbability — "will I recover cost basis + min net within N days?"
 *
 * The bundle the agent computes once per SKU and reuses across
 * `evaluate`, `discover`, `draft`, `reprice`.
 */

import type {
	RecoveryRequest,
	RecoveryResponse,
	ResearchThesisRequest,
	ResearchThesisResponse,
} from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface ResearchClient {
	thesis(req: ResearchThesisRequest): Promise<ResearchThesisResponse>;
	recoveryProbability(req: RecoveryRequest): Promise<RecoveryResponse>;
}

export function createResearchClient(http: FlipagentHttp): ResearchClient {
	return {
		thesis: (req) => http.post("/v1/research/thesis", req),
		recoveryProbability: (req) => http.post("/v1/research/recovery_probability", req),
	};
}
