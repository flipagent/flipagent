/**
 * `client.browser.*` — synchronous DOM primitives. Round-trip the
 * user's active Chrome tab through the bridge protocol; calls return
 * inline (no separate poll). Requires the flipagent extension to be
 * installed + paired.
 *
 *   client.browser.query(req)
 *     document.querySelectorAll on the current tab
 */

import type { BrowserQueryRequest, BrowserQueryResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface BrowserClient {
	query(req: BrowserQueryRequest): Promise<BrowserQueryResponse>;
}

export function createBrowserClient(http: FlipagentHttp): BrowserClient {
	return {
		query: (req) => http.post("/v1/browser/query", req),
	};
}
