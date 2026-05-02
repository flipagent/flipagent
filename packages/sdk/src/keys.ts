/**
 * `client.keys.*` — agent-facing key inspection. The calling key
 * authenticates these requests; the dashboard surface lives at
 * `/v1/me/*` (session cookies).
 */

import type { KeyInfo, KeyRevokeResponse, PermissionsResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface KeysClient {
	me(): Promise<KeyInfo>;
	revoke(): Promise<KeyRevokeResponse>;
	permissions(): Promise<PermissionsResponse>;
}

export function createKeysClient(http: FlipagentHttp): KeysClient {
	return {
		me: () => http.get("/v1/keys/me"),
		revoke: () => http.post("/v1/keys/revoke"),
		permissions: () => http.get("/v1/keys/permissions"),
	};
}
