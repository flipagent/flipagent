/**
 * Shared CSRF state store + authorize-URL builder for eBay OAuth handshakes.
 * Used by both:
 *   - `/v1/connect/ebay` (API-key-driven; for SDK / agent callers)
 *   - `/v1/me/ebay/connect` (session-driven; for the dashboard)
 *
 * Both end at the same callback URL (`/v1/connect/ebay/callback`) which
 * looks up the state to find the api-key the binding goes against, then
 * redirects to a dashboard page.
 *
 * In-process map; fine while the api runs single-replica. Promote to Redis
 * when scaling.
 */

import { randomBytes } from "node:crypto";
import { config } from "../config.js";

export interface PendingEbayState {
	apiKeyId: string;
	/** Where to redirect the user's browser after the callback finishes. */
	redirectAfter: string;
	expiresAt: number;
}

const STATE_TTL_MS = 10 * 60 * 1000;
const stateStore = new Map<string, PendingEbayState>();

function gcStates() {
	const now = Date.now();
	for (const [k, v] of stateStore) if (v.expiresAt < now) stateStore.delete(k);
}

export function rememberState(apiKeyId: string, redirectAfter: string): string {
	gcStates();
	const state = randomBytes(16).toString("base64url");
	stateStore.set(state, { apiKeyId, redirectAfter, expiresAt: Date.now() + STATE_TTL_MS });
	return state;
}

export function consumeState(state: string): PendingEbayState | null {
	gcStates();
	const pending = stateStore.get(state);
	if (!pending) return null;
	stateStore.delete(state);
	return pending;
}

export function buildEbayAuthorizeUrl(state: string): string {
	const params = new URLSearchParams({
		client_id: config.EBAY_CLIENT_ID!,
		response_type: "code",
		redirect_uri: config.EBAY_RU_NAME!,
		scope: config.EBAY_SCOPES,
		state,
	});
	return `${config.EBAY_AUTH_URL}/oauth2/authorize?${params}`;
}

/**
 * Whitelist redirect targets to APP_URL prefix to prevent open-redirect
 * abuse. Falls back to `${APP_URL}/dashboard` if the requested target
 * doesn't start with our configured app origin.
 */
export function safeRedirectTarget(requested: string | undefined): string {
	const fallback = `${config.APP_URL.replace(/\/+$/, "")}/dashboard`;
	if (!requested) return fallback;
	if (requested.startsWith(config.APP_URL)) return requested;
	return fallback;
}
