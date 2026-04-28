/**
 * `client.webhooks.*` — manage outbound event subscriptions.
 *
 *   client.webhooks.register({ url, events, description? })
 *   client.webhooks.list()
 *   client.webhooks.revoke(id)
 *   client.webhooks.verifySignature(secret, rawBody, header)
 *
 * Each delivery carries a `Flipagent-Signature: t=…,v1=…` header
 * (HMAC-SHA256 over `<t>.<rawBody>` using the endpoint's shared secret).
 * Receivers should reject deliveries with t older than ~5 min.
 */

import type { ListWebhooksResponse, RegisterWebhookRequest, RegisterWebhookResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface WebhooksClient {
	register(req: RegisterWebhookRequest): Promise<RegisterWebhookResponse>;
	list(): Promise<ListWebhooksResponse>;
	revoke(id: string): Promise<void>;
	/**
	 * Verify a `Flipagent-Signature` header against the raw request body.
	 * Pure function — does not call the API. Returns true iff a `v1=` value
	 * matches and the timestamp is within tolerance (default 300s).
	 */
	verifySignature(secret: string, rawBody: string, header: string, toleranceSec?: number): Promise<boolean>;
}

export function createWebhooksClient(http: FlipagentHttp): WebhooksClient {
	return {
		register: (req) => http.post<RegisterWebhookResponse>("/v1/webhooks", req),
		list: () => http.get<ListWebhooksResponse>("/v1/webhooks"),
		revoke: async (id) => {
			await http.delete<void>(`/v1/webhooks/${encodeURIComponent(id)}`);
		},
		verifySignature,
	};
}

async function verifySignature(
	secret: string,
	rawBody: string,
	header: string,
	toleranceSec: number = 300,
): Promise<boolean> {
	const parts = Object.fromEntries(
		header.split(",").map((kv) => {
			const idx = kv.indexOf("=");
			return [kv.slice(0, idx).trim(), kv.slice(idx + 1).trim()];
		}),
	);
	const t = Number(parts.t);
	if (!Number.isFinite(t)) return false;
	if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
	const expected = await hmacSha256Hex(secret, `${t}.${rawBody}`);
	return safeEqual(expected, parts.v1 ?? "");
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
	const subtle = globalThis.crypto?.subtle;
	if (subtle) {
		const enc = new TextEncoder();
		const key = await subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
		const sig = await subtle.sign("HMAC", key, enc.encode(message));
		return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
	}
	// Node ≥20 has WebCrypto exposed by default; this fallback is for very
	// old runtimes. Done dynamically so the SDK stays browser-friendly.
	const { createHmac } = await import("node:crypto");
	return createHmac("sha256", secret).update(message).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}
