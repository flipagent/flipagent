/**
 * `client.transfers.*` — sell/finances inter-account transfers.
 */

import type { TransfersListResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface TransfersClient {
	list(): Promise<TransfersListResponse>;
}

export function createTransfersClient(http: FlipagentHttp): TransfersClient {
	return {
		list: () => http.get("/v1/transfers"),
	};
}
