/**
 * `client.reprice.*` — decide hold/drop/delist for a sitting listing.
 * Pure compute over the supplied market summary + the listing's current
 * price + listed-at timestamp.
 */

import type { RepriceRequest, RepriceResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface RepriceClient {
	listing(req: RepriceRequest): Promise<RepriceResponse>;
}

export function createRepriceClient(http: FlipagentHttp): RepriceClient {
	return {
		listing: (req) => http.post("/v1/reprice", req),
	};
}
