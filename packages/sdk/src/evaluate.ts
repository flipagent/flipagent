/**
 * `client.evaluate.*` — single-listing judgment. flipagent's Decisions
 * pillar over HTTP. Math runs server-side so all language SDKs return
 * identical verdicts.
 */

import type { DealVerdict, EvaluateRequest, EvaluateSignalsRequest, EvaluateSignalsResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface EvaluateClient {
	listing(req: EvaluateRequest): Promise<DealVerdict>;
	signals(req: EvaluateSignalsRequest): Promise<EvaluateSignalsResponse>;
}

export function createEvaluateClient(http: FlipagentHttp): EvaluateClient {
	return {
		listing: (req) => http.post("/v1/evaluate", req),
		signals: (req) => http.post("/v1/evaluate/signals", req),
	};
}
