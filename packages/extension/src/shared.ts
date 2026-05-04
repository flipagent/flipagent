/**
 * Shared types + storage + HTTP helpers used by background, content,
 * options, popup. Kept in one file because the extension is small and
 * MV3 service workers really like fewer module boundaries.
 */

import type {
	BridgeLoginStatusRequest,
	BridgePeLoginStatusRequest,
	BridgePollJob,
	BridgeResultRequest,
	CapabilitiesResponse,
} from "@flipagent/types";

/* Build-time constants — see build.mjs `define` + globals.d.ts. Prod
 * build bakes `https://api.flipagent.dev` + `https://flipagent.dev`;
 * dev build (`npm run build:dev`) bakes `http://localhost:4000` +
 * `http://localhost:4321`. The published Chrome Web Store build is
 * always the prod variant. */
export const DEFAULT_BASE_URL = __FLIPAGENT_API_BASE__;
export const DEFAULT_DASHBOARD_BASE_URL = __FLIPAGENT_DASHBOARD_BASE__;

export interface ExtensionConfig {
	baseUrl: string;
	apiKey?: string;
	bridgeToken?: string;
	bridgeTokenId?: string;
	deviceName?: string;
	/**
	 * Opt-in: when true, the content script auto-parses every public eBay
	 * PDP the user visits and pushes it to /v1/bridge/capture so the
	 * shared catalog is naturally seeded as users browse. Default false —
	 * users explicitly enable from the popup. Personal pages (My eBay,
	 * checkout, sign-in, seller hub) are never sent regardless of this
	 * toggle (URL allowlist applied client-side AND server-side).
	 */
	captureEnabled?: boolean;
}

const DEFAULT_CONFIG: ExtensionConfig = {
	baseUrl: DEFAULT_BASE_URL,
};

export async function loadConfig(): Promise<ExtensionConfig> {
	const stored = await chrome.storage.local.get(["flipagent"]);
	const cfg = (stored.flipagent ?? {}) as Partial<ExtensionConfig>;
	return { ...DEFAULT_CONFIG, ...cfg };
}

export async function saveConfig(patch: Partial<ExtensionConfig>): Promise<ExtensionConfig> {
	const current = await loadConfig();
	const next = { ...current, ...patch };
	await chrome.storage.local.set({ flipagent: next });
	return next;
}

export async function clearConfig(): Promise<void> {
	await chrome.storage.local.remove(["flipagent"]);
}

/* --------------------------------- HTTP -------------------------------- */

interface ApiCallOpts {
	method?: "GET" | "POST" | "DELETE";
	auth: "apiKey" | "bridgeToken";
	body?: unknown;
	timeoutMs?: number;
}

export class ApiError extends Error {
	readonly status: number;
	readonly path: string;
	readonly detail: unknown;
	constructor(status: number, path: string, detail: unknown) {
		super(`${path} → ${status}`);
		this.status = status;
		this.path = path;
		this.detail = detail;
	}
}

export async function apiCall<T>(
	cfg: ExtensionConfig,
	path: string,
	opts: ApiCallOpts,
): Promise<{ status: number; body: T | null }> {
	const auth = opts.auth === "apiKey" ? cfg.apiKey : cfg.bridgeToken;
	if (!auth) {
		throw new ApiError(401, path, { error: `missing_${opts.auth}` });
	}
	const url = cfg.baseUrl.replace(/\/+$/, "") + path;
	const controller = new AbortController();
	const timer = opts.timeoutMs ? setTimeout(() => controller.abort(), opts.timeoutMs) : null;
	try {
		const res = await fetch(url, {
			method: opts.method ?? "GET",
			headers: {
				Accept: "application/json",
				...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
				Authorization: `Bearer ${auth}`,
			},
			body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
			signal: controller.signal,
		});
		const text = await res.text();
		const parsed = text ? safeJson(text) : null;
		if (!res.ok) {
			throw new ApiError(res.status, path, parsed ?? text);
		}
		return { status: res.status, body: parsed as T | null };
	} finally {
		if (timer) clearTimeout(timer);
	}
}

function safeJson(s: string): unknown {
	try {
		return JSON.parse(s);
	} catch {
		return s;
	}
}

/* ----------------------------- bridge calls ----------------------------- */

export async function pollForJob(cfg: ExtensionConfig, signal?: AbortSignal): Promise<BridgePollJob | null> {
	const url = `${cfg.baseUrl.replace(/\/+$/, "")}/v1/bridge/poll`;
	const res = await fetch(url, {
		headers: { Authorization: `Bearer ${cfg.bridgeToken ?? ""}` },
		signal,
	});
	if (res.status === 204) return null;
	if (!res.ok) throw new ApiError(res.status, "/v1/bridge/poll", await res.text().catch(() => ""));
	return (await res.json()) as BridgePollJob;
}

export async function reportResult(cfg: ExtensionConfig, body: BridgeResultRequest): Promise<void> {
	await apiCall(cfg, "/v1/bridge/result", { method: "POST", auth: "bridgeToken", body, timeoutMs: 10_000 });
}

export async function reportLoginStatus(cfg: ExtensionConfig, body: BridgeLoginStatusRequest): Promise<void> {
	await apiCall(cfg, "/v1/bridge/login-status", {
		method: "POST",
		auth: "bridgeToken",
		body,
		timeoutMs: 10_000,
	});
}

export async function reportPeLoginStatus(cfg: ExtensionConfig, body: BridgePeLoginStatusRequest): Promise<void> {
	await apiCall(cfg, "/v1/bridge/pe-login-status", {
		method: "POST",
		auth: "bridgeToken",
		body,
		timeoutMs: 10_000,
	});
}

export interface BridgeCaptureResult {
	stored: boolean;
	itemId?: string;
	reason?: string;
	cachedFor?: number;
}

/**
 * Push a parsed eBay PDP to the hosted catalog cache. Fire-and-forget
 * from the caller's perspective — we still await so the per-tab debounce
 * in content.ts knows the request finished, but errors are swallowed
 * (a failed capture must not perturb the user's eBay browsing).
 *
 * Server-side (`POST /v1/bridge/capture`) re-validates the URL and
 * enforces a 60-per-minute rate limit per api key — a misbehaving client
 * gets a 429, which we surface back as `{ stored: false }` so the caller
 * just moves on.
 */
export async function pushCapture(
	cfg: ExtensionConfig,
	body: { url: string; rawDetail: unknown },
): Promise<BridgeCaptureResult> {
	try {
		const r = await apiCall<BridgeCaptureResult>(cfg, "/v1/bridge/capture", {
			method: "POST",
			auth: "bridgeToken",
			body,
			timeoutMs: 10_000,
		});
		return r.body ?? { stored: false, reason: "no_body" };
	} catch (err) {
		const status = err instanceof ApiError ? err.status : 0;
		return { stored: false, reason: status === 429 ? "rate_limited" : "request_failed" };
	}
}

type EbayConnectStatus = {
	oauth: {
		connected: boolean;
		ebayUserId: string | null;
		ebayUserName: string | null;
		scopes: string[];
		accessTokenExpiresAt: string | null;
		connectedAt: string | null;
	};
	bridge: {
		paired: boolean;
		deviceName: string | null;
		lastSeenAt: string | null;
		ebayLoggedIn: boolean;
		ebayUserName: string | null;
		verifiedAt: string | null;
	};
};

export async function fetchConnectStatus(cfg: ExtensionConfig): Promise<EbayConnectStatus> {
	const r = await apiCall<EbayConnectStatus>(cfg, "/v1/connect/ebay/status", { auth: "apiKey", timeoutMs: 10_000 });
	if (!r.body) throw new ApiError(500, "/v1/connect/ebay/status", "empty body");
	return r.body;
}

/**
 * Fetch the capability matrix — single source of truth for the popup
 * setup checklist. Auth via api key; no bridge token required, so it
 * works the moment a key is pasted (before the first bridge poll).
 */
export async function fetchCapabilities(cfg: ExtensionConfig): Promise<CapabilitiesResponse> {
	const r = await apiCall<CapabilitiesResponse>(cfg, "/v1/capabilities", { auth: "apiKey", timeoutMs: 10_000 });
	if (!r.body) throw new ApiError(500, "/v1/capabilities", "empty body");
	return r.body;
}

/* Storage helpers + cross-context types live in `storage.ts` (one
 * source of truth for chrome.storage.local). This module owns config +
 * HTTP only — keep it that way. */
