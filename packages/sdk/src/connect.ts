/**
 * `client.connect.*` — per-marketplace OAuth bind status / disconnect
 * for the calling api key. Each marketplace nests its own ops under
 * `connect.<marketplace>.*` so the namespace tracks the route shape
 * (`/v1/connect/<marketplace>/<verb>`) and stays uncluttered as more
 * marketplaces (Amazon, Mercari) come online.
 *
 *   client.connect.ebay.status()
 *     → GET /v1/connect/ebay/status
 *
 *   client.connect.ebay.disconnect()
 *     → DELETE /v1/connect/ebay
 *
 * The interactive bind itself (`GET /v1/connect/ebay`) is a browser
 * redirect flow, not exposed here.
 */

import type { FlipagentHttp } from "./http.js";

export interface EbayConnectStatus {
	connected: boolean;
	ebayUserId?: string;
	scopes?: string[];
	expiresAt?: string;
}

export interface ConnectMarketplaceClient {
	status(): Promise<EbayConnectStatus>;
	disconnect(): Promise<{ disconnected: true }>;
}

export interface ConnectClient {
	ebay: ConnectMarketplaceClient;
}

function createMarketplaceClient(http: FlipagentHttp, marketplace: string): ConnectMarketplaceClient {
	const base = `/v1/connect/${encodeURIComponent(marketplace)}`;
	return {
		status: () => http.get(`${base}/status`),
		disconnect: () => http.delete(base),
	};
}

export function createConnectClient(http: FlipagentHttp): ConnectClient {
	return {
		ebay: createMarketplaceClient(http, "ebay"),
	};
}
