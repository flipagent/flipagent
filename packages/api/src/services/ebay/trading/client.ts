/**
 * Shared low-level Trading API client. eBay's legacy XML/SOAP API
 * still owns several flows that never made it into the REST surface
 * (messages, RespondToBestOffer, LeaveFeedback / GetFeedback,
 * RelistItem, …). Each call is one XML envelope POSTed to
 * `https://api.ebay.com/ws/api.dll` with a few pinned headers.
 *
 * Auth: pass the seller's eBay user OAuth access token via the
 * `X-EBAY-API-IAF-TOKEN` header. Trading bridges OAuth tokens via
 * "IAF" (Identity Auth Framework); the legacy AuthToken path is
 * deprecated.
 *
 * This module is the *transport*. Per-call request/response shaping
 * lives in sibling files (`messages.ts`, `best-offer.ts`, etc.).
 */

import { XMLParser } from "fast-xml-parser";

const TRADING_ENDPOINT = "https://api.ebay.com/ws/api.dll";
// Compatibility level — pinned. eBay deprecates old levels slowly;
// 1349 is current as of 2026 and supports every call we touch.
export const TRADING_COMPAT_LEVEL = "1349";

const xmlParser = new XMLParser({
	ignoreAttributes: false,
	removeNSPrefix: true,
	parseTagValue: true,
	trimValues: true,
});

export interface TradingErrorEntry {
	code: string;
	message: string;
	severity: string;
}

export class TradingApiError extends Error {
	readonly status: number;
	readonly callName: string;
	readonly errors: TradingErrorEntry[];
	constructor(callName: string, status: number, errors: TradingErrorEntry[], summary: string) {
		super(`Trading ${callName} ${status}: ${summary}`);
		this.name = "TradingApiError";
		this.callName = callName;
		this.status = status;
		this.errors = errors;
	}
}

/**
 * Issue a Trading XML call. Returns the raw XML body on success;
 * caller is responsible for parsing it into the domain shape (see
 * `parseTrading()`). `siteId` defaults to "0" (US) — pass other site
 * ids when targeting non-US Trading flows. `timeoutMs` defaults to
 * 20s; we abort and throw a `TradingApiError` rather than letting a
 * stuck upstream pin the route handler.
 */
const DEFAULT_TIMEOUT_MS = 20_000;

export async function tradingCall(args: {
	callName: string;
	accessToken: string;
	body: string;
	siteId?: string;
	timeoutMs?: number;
}): Promise<string> {
	const ctrl = new AbortController();
	const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const timer = setTimeout(() => ctrl.abort(), timeoutMs);
	let res: Response;
	try {
		res = await fetch(TRADING_ENDPOINT, {
			method: "POST",
			headers: {
				"X-EBAY-API-CALL-NAME": args.callName,
				"X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_COMPAT_LEVEL,
				"X-EBAY-API-SITEID": args.siteId ?? "0",
				"X-EBAY-API-IAF-TOKEN": args.accessToken,
				"Content-Type": "text/xml",
			},
			body: args.body,
			signal: ctrl.signal,
		});
	} catch (err) {
		clearTimeout(timer);
		if (err instanceof Error && err.name === "AbortError") {
			throw new TradingApiError(args.callName, 504, [], `upstream timeout after ${timeoutMs}ms`);
		}
		throw err;
	}
	clearTimeout(timer);
	const text = await res.text();
	if (!res.ok) {
		throw new TradingApiError(args.callName, res.status, [], text.slice(0, 500));
	}
	return text;
}

/**
 * Parse a Trading XML response and surface flipagent-typed errors.
 * The shape is consistent across calls: a `<{CallName}Response>` root
 * with `Ack` ("Success" | "Warning" | "Failure") and an optional
 * `Errors` array. We surface a typed exception on Failure so callers
 * don't have to re-decode the structured-error envelope.
 */
export function parseTrading<T = Record<string, unknown>>(xml: string, callName: string): T {
	const parsed = xmlParser.parse(xml) as Record<string, unknown>;
	const root = (parsed[`${callName}Response`] ?? parsed) as Record<string, unknown>;
	const ack = root.Ack as string | undefined;
	if (ack === "Failure") {
		const errors = arrayify(root.Errors).map<TradingErrorEntry>((e) => ({
			code: stringFrom(e.ErrorCode) ?? "",
			message: stringFrom(e.LongMessage) ?? stringFrom(e.ShortMessage) ?? "",
			severity: stringFrom(e.SeverityCode) ?? "",
		}));
		const summary = errors.map((e) => `${e.code}: ${e.message}`).join("; ") || "unspecified";
		throw new TradingApiError(callName, 200, errors, summary);
	}
	return root as T;
}

export function arrayify(v: unknown): Array<Record<string, unknown>> {
	if (v == null) return [];
	if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
	return [v as Record<string, unknown>];
}

export function stringFrom(v: unknown): string | null {
	if (v == null) return null;
	if (typeof v === "string") return v;
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	return null;
}

export function escapeXml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
