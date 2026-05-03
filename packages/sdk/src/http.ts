/**
 * Tiny HTTP layer shared by every namespace. Bearer auth, JSON in/out,
 * `FlipagentApiError` on non-2xx with the upstream payload attached.
 */

export class FlipagentApiError extends Error {
	readonly status: number;
	readonly path: string;
	readonly detail: unknown;
	constructor(status: number, path: string, detail: unknown) {
		super(`flipagent ${path} failed with status ${status}`);
		this.name = "FlipagentApiError";
		this.status = status;
		this.path = path;
		this.detail = detail;
	}
}

export interface HttpOptions {
	apiKey: string;
	baseUrl: string;
	fetch?: typeof globalThis.fetch;
}

export type RequestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface FlipagentHttp {
	request<T>(
		method: RequestMethod,
		path: string,
		body?: unknown,
		query?: Record<string, string | number | undefined>,
	): Promise<T>;
	get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T>;
	post<T>(path: string, body?: unknown): Promise<T>;
	put<T>(path: string, body?: unknown): Promise<T>;
	patch<T>(path: string, body?: unknown): Promise<T>;
	delete<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T>;
	/** POST a non-JSON body (e.g. multipart FormData). Caller owns Content-Type. */
	postRaw<T>(path: string, body: BodyInit): Promise<T>;
	/** Raw `fetch` for binary downloads — returns the unparsed Response. */
	fetchRaw(path: string, init?: RequestInit): Promise<Response>;
}

export function createHttp(opts: HttpOptions): FlipagentHttp {
	const baseUrl = opts.baseUrl.replace(/\/+$/, "");
	const fetchImpl = opts.fetch ?? globalThis.fetch;
	const baseHeaders = {
		Accept: "application/json",
		Authorization: `Bearer ${opts.apiKey}`,
	} as const;

	function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
		const url = new URL(path, baseUrl);
		if (query) {
			for (const [k, v] of Object.entries(query)) {
				if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
			}
		}
		return url.toString();
	}

	async function request<T>(
		method: RequestMethod,
		path: string,
		body?: unknown,
		query?: Record<string, string | number | undefined>,
	): Promise<T> {
		const headers: Record<string, string> = { ...baseHeaders };
		const init: RequestInit = { method, headers };
		if (body !== undefined && method !== "GET" && method !== "DELETE") {
			headers["Content-Type"] = "application/json";
			init.body = JSON.stringify(body);
		}
		const res = await fetchImpl(buildUrl(path, query), init);
		if (!res.ok) {
			let detail: unknown;
			try {
				detail = await res.json();
			} catch {
				detail = await res.text().catch(() => undefined);
			}
			throw new FlipagentApiError(res.status, path, detail);
		}
		// Handle empty bodies (204 No Content, etc.)
		const text = await res.text();
		return (text ? JSON.parse(text) : undefined) as T;
	}

	async function postRaw<T>(path: string, body: BodyInit): Promise<T> {
		const res = await fetchImpl(buildUrl(path), {
			method: "POST",
			headers: { ...baseHeaders },
			body,
		});
		if (!res.ok) {
			let detail: unknown;
			try {
				detail = await res.json();
			} catch {
				detail = await res.text().catch(() => undefined);
			}
			throw new FlipagentApiError(res.status, path, detail);
		}
		const text = await res.text();
		return (text ? JSON.parse(text) : undefined) as T;
	}

	async function fetchRaw(path: string, init?: RequestInit): Promise<Response> {
		const merged: RequestInit = {
			...init,
			headers: { ...baseHeaders, ...((init?.headers as Record<string, string>) ?? {}) },
		};
		return fetchImpl(buildUrl(path), merged);
	}

	return {
		request,
		get: (path, query) => request("GET", path, undefined, query),
		post: (path, body) => request("POST", path, body),
		put: (path, body) => request("PUT", path, body),
		patch: (path, body) => request("PATCH", path, body),
		delete: (path, query) => request("DELETE", path, undefined, query),
		postRaw,
		fetchRaw,
	};
}
