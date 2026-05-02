/**
 * `client.feeds.*` — bulk feed tasks (listing / order / finance).
 */

import type { FeedsListResponse, FeedTask, FeedTaskCreate } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface FeedsClient {
	list(opts?: { kind?: FeedTaskCreate["kind"] }): Promise<FeedsListResponse>;
	create(body: FeedTaskCreate): Promise<FeedTask>;
	get(id: string): Promise<FeedTask>;
}

export function createFeedsClient(http: FlipagentHttp): FeedsClient {
	return {
		list: (opts) => http.get("/v1/feeds", opts?.kind ? { kind: opts.kind } : undefined),
		create: (body) => http.post("/v1/feeds", body),
		get: (id) => http.get(`/v1/feeds/${encodeURIComponent(id)}`),
	};
}
