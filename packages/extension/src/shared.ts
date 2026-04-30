/**
 * Shared types + storage + HTTP helpers used by background, content,
 * options, popup. Kept in one file because the extension is small and
 * MV3 service workers really like fewer module boundaries.
 */

import type {
	BridgeLoginStatusRequest,
	BridgePollJob,
	BridgeResultRequest,
	IssueBridgeTokenResponse,
} from "@flipagent/types";
import type { EbayPurchaseOrder } from "@flipagent/types/ebay/buy";

export const DEFAULT_BASE_URL = "https://api.flipagent.dev";

export interface ExtensionConfig {
	baseUrl: string;
	apiKey?: string;
	bridgeToken?: string;
	bridgeTokenId?: string;
	deviceName?: string;
}

export const DEFAULT_CONFIG: ExtensionConfig = {
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

export async function issueBridgeToken(cfg: ExtensionConfig, deviceName: string): Promise<IssueBridgeTokenResponse> {
	const r = await apiCall<IssueBridgeTokenResponse>(cfg, "/v1/bridge/tokens", {
		method: "POST",
		auth: "apiKey",
		body: { deviceName },
		timeoutMs: 15_000,
	});
	if (!r.body) throw new ApiError(500, "/v1/bridge/tokens", "empty body");
	return r.body;
}

export async function pollForJob(cfg: ExtensionConfig, signal?: AbortSignal): Promise<BridgePollJob | null> {
	const url = cfg.baseUrl.replace(/\/+$/, "") + "/v1/bridge/poll";
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

export async function getOrderStatus(cfg: ExtensionConfig, purchaseOrderId: string): Promise<EbayPurchaseOrder> {
	const path = `/v1/buy/order/purchase_order/${encodeURIComponent(purchaseOrderId)}`;
	const r = await apiCall<EbayPurchaseOrder>(cfg, path, { auth: "apiKey", timeoutMs: 10_000 });
	if (!r.body) throw new ApiError(500, path, "empty body");
	return r.body;
}

export async function cancelOrder(cfg: ExtensionConfig, purchaseOrderId: string): Promise<EbayPurchaseOrder> {
	const path = `/v1/buy/order/purchase_order/${encodeURIComponent(purchaseOrderId)}/cancel`;
	const r = await apiCall<EbayPurchaseOrder>(cfg, path, { method: "POST", auth: "apiKey", timeoutMs: 10_000 });
	if (!r.body) throw new ApiError(500, path, "empty body");
	return r.body;
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

/* -------------------------- ebay buyer-state probe -------------------------- */

/**
 * Cached buyer-session snapshot the content script reports on every
 * ebay.com page load. Service worker reads this synchronously instead
 * of probing eBay itself — fetches from the SW context don't get the
 * SameSite=Lax/Strict auth cookies, so DOM inspection from inside the
 * page is the only reliable signal. This is the same pattern Honey
 * and Capital One Shopping use.
 */
export interface BuyerStateSnapshot {
	loggedIn: boolean;
	ebayUserName?: string;
	updatedAt: string;
}

const BUYER_STATE_KEY = "flipagent_buyer_state";

export async function readBuyerState(): Promise<BuyerStateSnapshot | null> {
	const stored = await chrome.storage.local.get([BUYER_STATE_KEY]);
	return (stored[BUYER_STATE_KEY] ?? null) as BuyerStateSnapshot | null;
}

export async function writeBuyerState(snap: BuyerStateSnapshot): Promise<void> {
	await chrome.storage.local.set({ [BUYER_STATE_KEY]: snap });
}
