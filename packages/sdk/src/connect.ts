/**
 * `client.connect.*` — eBay OAuth bind status / disconnect for the
 * calling api key. The interactive bind itself (GET /v1/connect/ebay)
 * is a browser redirect flow, not exposed here.
 */

import type { FlipagentHttp } from "./http.js";

export interface EbayConnectStatus {
	connected: boolean;
	ebayUserId?: string;
	scopes?: string[];
	expiresAt?: string;
}

export interface ConnectClient {
	ebayStatus(): Promise<EbayConnectStatus>;
	ebayDisconnect(): Promise<{ disconnected: true }>;
}

export function createConnectClient(http: FlipagentHttp): ConnectClient {
	return {
		ebayStatus: () => http.get("/v1/connect/ebay/status"),
		ebayDisconnect: () => http.delete("/v1/connect/ebay"),
	};
}
