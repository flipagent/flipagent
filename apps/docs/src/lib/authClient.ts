import { createAuthClient } from "better-auth/react";

const API_BASE = (import.meta.env.PUBLIC_API_BASE_URL ?? "https://api.flipagent.dev").replace(/\/+$/, "");

export const authClient = createAuthClient({ baseURL: API_BASE });
export const { signIn, signOut, useSession } = authClient;

/**
 * Same-origin-aware fetch helper for /v1/me/* — always includes credentials
 * so the Better-Auth session cookie travels cross-origin to the api.
 */
export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`, {
		...init,
		credentials: "include",
		headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({ error: "request_failed" }));
		throw Object.assign(new Error(body.message ?? body.error ?? `HTTP ${res.status}`), { status: res.status, body });
	}
	return res.json() as Promise<T>;
}

export const apiBase = API_BASE;
