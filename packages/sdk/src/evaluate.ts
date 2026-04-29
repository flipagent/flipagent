/**
 * `client.evaluate.*` — single-listing judgment. flipagent's Decisions
 * pillar over HTTP. Math runs server-side so all language SDKs return
 * identical evaluations.
 */

import type { EvaluateRequest, EvaluateSignalsRequest, EvaluateSignalsResponse, Evaluation } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface EvaluateClient {
	listing(req: EvaluateRequest): Promise<Evaluation>;
	signals(req: EvaluateSignalsRequest): Promise<EvaluateSignalsResponse>;
}

export function createEvaluateClient(http: FlipagentHttp): EvaluateClient {
	return {
		listing: (req) => http.post("/v1/evaluate", req),
		signals: (req) => http.post("/v1/evaluate/signals", req),
	};
}
