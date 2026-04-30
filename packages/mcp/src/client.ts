/**
 * Builds the flipagent client used by every tool. Thin wrapper around
 * `@flipagent/sdk`, which talks to `api.flipagent.dev` (or
 * `FLIPAGENT_BASE_URL` override for self-host / dev) under the unified
 * `/v1/*` surface.
 */

import { createFlipagentClient, FlipagentApiError, type FlipagentClient } from "@flipagent/sdk";
import type { Config } from "./config.js";

export class ApiCallError extends Error {
	readonly status: number | undefined;
	readonly url: string | undefined;
	constructor(message: string, opts: { status?: number; url?: string }) {
		super(message);
		this.name = "ApiCallError";
		this.status = opts.status;
		this.url = opts.url;
	}
}

export function getClient(config: Config): FlipagentClient {
	return createFlipagentClient({
		apiKey: config.authToken ?? "",
		// Hits api.flipagent.dev (or override via FLIPAGENT_BASE_URL for
		// self-host / dev). eBay's own base URL (sandbox vs prod) is
		// resolved server-side, not here.
		baseUrl: config.flipagentBaseUrl,
	});
}

type AnyShapedError = {
	message?: string;
	status?: number;
	path?: string;
	meta?: { res?: { status?: number }; url?: string };
	response?: { status?: number };
	config?: { url?: string };
};

export function toApiCallError(err: unknown, fallbackPath?: string): ApiCallError {
	if (err instanceof ApiCallError) return err;
	if (typeof FlipagentApiError === "function" && err instanceof FlipagentApiError) {
		return new ApiCallError(err.message, { status: err.status, url: err.path });
	}
	const e = (err ?? {}) as AnyShapedError;
	const status = e.status ?? e.meta?.res?.status ?? e.response?.status;
	const url = e.path ?? e.meta?.url ?? e.config?.url ?? fallbackPath;
	const message = e.message ?? "request failed";
	return new ApiCallError(message, { status, url });
}
