/**
 * `client.draft.*` — recommend an optimal listing for a (re)listing.
 * Sell-side counterpart to `evaluate` (buy-side). Returns the EV-optimal
 * list price + a title to use; agent merges with its own category +
 * business-policy choices, then pushes via `client.inventory.*`.
 */

import type { DraftRequest, DraftResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface DraftClient {
	listing(req: DraftRequest): Promise<DraftResponse>;
}

export function createDraftClient(http: FlipagentHttp): DraftClient {
	return {
		listing: (req) => http.post("/v1/draft", req),
	};
}
