/**
 * `client.forwarder.*` — package forwarder ops (Planet Express today,
 * MyUS / Stackry / etc. when wired). Bridge-driven: the user's
 * flipagent Chrome extension reads their logged-in forwarder inbox.
 *
 *   client.forwarder.refresh({ provider })           — queue an inbox-pull job
 *   client.forwarder.jobs.get({ provider, jobId })   — poll status + packages
 *
 * Sits at `client.forwarder.*` (not under buy or sell) because
 * forwarders show up in both flows: inbound during sourcing, outbound
 * consolidation when listing from forwarder stock.
 */

import type { ForwarderJobResponse, ForwarderProvider, ForwarderRefreshResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface ForwarderClient {
	refresh(args: { provider: ForwarderProvider }): Promise<ForwarderRefreshResponse>;
	jobs: {
		get(args: { provider: ForwarderProvider; jobId: string }): Promise<ForwarderJobResponse>;
	};
}

export function createForwarderClient(http: FlipagentHttp): ForwarderClient {
	return {
		refresh: ({ provider }) =>
			http.post<ForwarderRefreshResponse>(`/v1/forwarder/${encodeURIComponent(provider)}/refresh`, {}),
		jobs: {
			get: ({ provider, jobId }) =>
				http.get<ForwarderJobResponse>(
					`/v1/forwarder/${encodeURIComponent(provider)}/jobs/${encodeURIComponent(jobId)}`,
				),
		},
	};
}
