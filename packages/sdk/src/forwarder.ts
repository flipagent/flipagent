/**
 * `client.forwarder.*` — package forwarder ops (Planet Express today,
 * MyUS / Stackry / etc. when wired). Bridge-driven: the user's
 * flipagent Chrome extension reads / writes their logged-in forwarder
 * session.
 *
 *   client.forwarder.refresh({ provider })
 *     queue an inbox-pull job
 *
 *   client.forwarder.packages.photos({ provider, packageId })
 *     queue a photo-fetch job for one package
 *
 *   client.forwarder.packages.dispatch({ provider, packageId, request })
 *     queue an outbound-shipment job (sell-side ship-out)
 *
 *   client.forwarder.jobs.get({ provider, jobId })
 *     poll any forwarder job's status + payload
 *
 * Sits at `client.forwarder.*` (not under buy or sell) because
 * forwarders show up in both flows: inbound during sourcing, outbound
 * dispatch when listing from forwarder stock.
 */

import type {
	ForwarderInventoryListResponse,
	ForwarderInventoryRow,
	ForwarderJobResponse,
	ForwarderLinkRequest,
	ForwarderProvider,
	ForwarderRefreshResponse,
	ForwarderShipmentRequest,
} from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface ForwarderClient {
	refresh(args: { provider: ForwarderProvider }): Promise<ForwarderRefreshResponse>;
	getAddress(args: { provider: ForwarderProvider }): Promise<ForwarderRefreshResponse>;
	packages: {
		photos(args: { provider: ForwarderProvider; packageId: string }): Promise<ForwarderRefreshResponse>;
		dispatch(args: {
			provider: ForwarderProvider;
			packageId: string;
			request: ForwarderShipmentRequest;
		}): Promise<ForwarderRefreshResponse>;
		link(args: {
			provider: ForwarderProvider;
			packageId: string;
			request: ForwarderLinkRequest;
		}): Promise<ForwarderInventoryRow>;
	};
	inventory: {
		list(args: { provider: ForwarderProvider }): Promise<ForwarderInventoryListResponse>;
		get(args: { provider: ForwarderProvider; packageId: string }): Promise<ForwarderInventoryRow>;
	};
	jobs: {
		get(args: { provider: ForwarderProvider; jobId: string }): Promise<ForwarderJobResponse>;
	};
}

export function createForwarderClient(http: FlipagentHttp): ForwarderClient {
	return {
		refresh: ({ provider }) =>
			http.post<ForwarderRefreshResponse>(`/v1/forwarder/${encodeURIComponent(provider)}/refresh`, {}),
		getAddress: ({ provider }) =>
			http.post<ForwarderRefreshResponse>(`/v1/forwarder/${encodeURIComponent(provider)}/address`, {}),
		packages: {
			photos: ({ provider, packageId }) =>
				http.post<ForwarderRefreshResponse>(
					`/v1/forwarder/${encodeURIComponent(provider)}/packages/${encodeURIComponent(packageId)}/photos`,
					{},
				),
			dispatch: ({ provider, packageId, request }) =>
				http.post<ForwarderRefreshResponse>(
					`/v1/forwarder/${encodeURIComponent(provider)}/packages/${encodeURIComponent(packageId)}/dispatch`,
					request,
				),
			link: ({ provider, packageId, request }) =>
				http.post<ForwarderInventoryRow>(
					`/v1/forwarder/${encodeURIComponent(provider)}/packages/${encodeURIComponent(packageId)}/link`,
					request,
				),
		},
		inventory: {
			list: ({ provider }) =>
				http.get<ForwarderInventoryListResponse>(`/v1/forwarder/${encodeURIComponent(provider)}/inventory`),
			get: ({ provider, packageId }) =>
				http.get<ForwarderInventoryRow>(
					`/v1/forwarder/${encodeURIComponent(provider)}/inventory/${encodeURIComponent(packageId)}`,
				),
		},
		jobs: {
			get: ({ provider, jobId }) =>
				http.get<ForwarderJobResponse>(
					`/v1/forwarder/${encodeURIComponent(provider)}/jobs/${encodeURIComponent(jobId)}`,
				),
		},
	};
}
