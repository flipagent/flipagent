/**
 * Builds the flipagent client used by every tool. Thin wrapper around
 * `@flipagent/sdk`, which talks to `api.flipagent.dev` (or
 * `FLIPAGENT_BASE_URL` override for self-host / dev) under the unified
 * `/v1/*` surface.
 *
 * `toApiCallError` is the boundary between SDK errors and the
 * tool-wrapper return shape. It pulls the api's `next_action` field out
 * of the response body so the central MCP handler can render OAuth
 * URLs, extension install links, etc. verbatim — no client-side
 * guessing about which remediation applies.
 */

import { createFlipagentClient, FlipagentApiError, type FlipagentClient } from "@flipagent/sdk";
import type { Config } from "./config.js";

export interface NextAction {
	kind?: string;
	url?: string;
	instructions?: string;
}

export class ApiCallError extends Error {
	readonly status: number | undefined;
	readonly url: string | undefined;
	readonly nextAction: NextAction | undefined;
	constructor(message: string, opts: { status?: number; url?: string; nextAction?: NextAction }) {
		super(message);
		this.name = "ApiCallError";
		this.status = opts.status;
		this.url = opts.url;
		this.nextAction = opts.nextAction;
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
	detail?: unknown;
	meta?: { res?: { status?: number }; url?: string };
	response?: { status?: number };
	config?: { url?: string };
};

function pickNextAction(detail: unknown): NextAction | undefined {
	if (!detail || typeof detail !== "object") return undefined;
	const na = (detail as { next_action?: unknown }).next_action;
	if (!na || typeof na !== "object") return undefined;
	const obj = na as Record<string, unknown>;
	const out: NextAction = {};
	if (typeof obj.kind === "string") out.kind = obj.kind;
	if (typeof obj.url === "string") out.url = obj.url;
	if (typeof obj.instructions === "string") out.instructions = obj.instructions;
	return out.kind || out.url || out.instructions ? out : undefined;
}

function pickServerMessage(detail: unknown, fallback: string): string {
	if (!detail || typeof detail !== "object") return fallback;
	const m = (detail as { message?: unknown; error?: unknown }).message;
	if (typeof m === "string" && m.length > 0) return m;
	const code = (detail as { error?: unknown }).error;
	if (typeof code === "string" && code.length > 0) return code;
	return fallback;
}

export function toApiCallError(err: unknown, fallbackPath?: string): ApiCallError {
	if (err instanceof ApiCallError) return err;
	if (typeof FlipagentApiError === "function" && err instanceof FlipagentApiError) {
		return new ApiCallError(pickServerMessage(err.detail, err.message), {
			status: err.status,
			url: err.path,
			nextAction: pickNextAction(err.detail),
		});
	}
	const e = (err ?? {}) as AnyShapedError;
	const status = e.status ?? e.meta?.res?.status ?? e.response?.status;
	const url = e.path ?? e.meta?.url ?? e.config?.url ?? fallbackPath;
	const message = pickServerMessage(e.detail, e.message ?? "request failed");
	const nextAction = pickNextAction(e.detail);
	return new ApiCallError(message, { status, url, nextAction });
}

/**
 * Convenience wrapper used by every tool execute fn — collapses the
 * standard try/catch boilerplate into:
 *
 *   return toolErrorEnvelope(err, "operation_kind_failed", "/v1/path")
 *
 * Returns the `{ error, status, url, message, next_action? }` shape the
 * central MCP handler in `src/index.ts` recognizes. Pass `staticHint`
 * for the rare case where the api can't carry remediation in
 * `next_action` because the cause is local to the MCP host (e.g.
 * planetexpress.com login lives in the user's Chrome profile, not in
 * any flipagent-side state).
 */
export function toolErrorEnvelope(err: unknown, errorCode: string, fallbackPath?: string, staticHint?: string) {
	const e = toApiCallError(err, fallbackPath);
	return {
		error: errorCode,
		status: e.status,
		url: e.url,
		message: e.message,
		...(e.nextAction ? { next_action: e.nextAction } : {}),
		...(staticHint ? { hint: staticHint } : {}),
	};
}
