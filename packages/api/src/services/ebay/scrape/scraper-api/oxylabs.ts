/**
 * Oxylabs Web Scraper API adapter. Realtime endpoint: POST a URL,
 * Basic auth, get rendered HTML in `results[0].content`. Whatever
 * upstream rendering Oxylabs performs is their product, behind their
 * Basic-auth credentials.
 *
 * In-process concurrency cap: Oxylabs Realtime enforces a parallel-
 * request limit per account ("Total Dynamic" 429 when exceeded). With
 * the multi-cluster discover pipeline we can fan out 20+ scrape calls
 * at once, easily tripping it. The adapter holds a semaphore that
 * limits the entire process to `MAX_CONCURRENT` in-flight Oxylabs
 * requests; excess callers queue and dispatch FIFO.
 */

import { config } from "../../../../config.js";
import { fetchRetry } from "../../../../utils/fetch-retry.js";
import { Semaphore } from "../../../../utils/semaphore.js";

interface OxylabsResult {
	content: string;
	status_code: number;
	url: string;
}

interface OxylabsResponse {
	results?: OxylabsResult[];
}

const ENDPOINT = "https://realtime.oxylabs.io/v1/queries";
const TIMEOUT_MS = 90_000;
/**
 * Per-account parallel-request cap Oxylabs enforces on the Realtime
 * endpoint. Empirically measured on the test/dev account: 15 in-flight
 * succeed, 16th returns 429 ("Total Dynamic") within ~700ms. Cap at 14
 * (1 slot headroom under the hard ceiling) so the in-process queue is
 * the sole gate — never trip Oxylabs's own 429. Discover fans many
 * detail/sold/active calls in parallel per request; this maximises
 * throughput regardless of which user fired them. Bump with the plan.
 */
const MAX_CONCURRENT = 14;

const semaphore = new Semaphore(MAX_CONCURRENT);

export async function fetchHtmlViaOxylabs(targetUrl: string): Promise<string> {
	if (!config.SCRAPER_API_USERNAME || !config.SCRAPER_API_PASSWORD) {
		throw new Error("scraper_api_not_configured");
	}
	return semaphore.run(() => callWithRetry(targetUrl));
}

/**
 * Oxylabs Realtime quirk: the wrapper API itself returns 200 OK and
 * carries the upstream eBay response (or its failure) inside
 * `results[0].status_code`. So a 4xx/5xx FROM eBay arrives as a 200
 * from Oxylabs's perspective — fetch-retry doesn't see it and won't
 * retry. We do that retry HERE: transient upstream codes (5xx, 408, 429,
 * Cloudflare 52x, 613 "faulty job") get up to 2 backoff retries before
 * surfacing. Without this, one flaky scrape silently drops a whole
 * cluster from a multi-cluster discover run.
 */
const RETRYABLE_UPSTREAM = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 613]);
const MAX_ATTEMPTS = 3;

async function callWithRetry(targetUrl: string): Promise<string> {
	let lastErr: unknown;
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		try {
			return await callOxylabs(targetUrl);
		} catch (err) {
			lastErr = err;
			const code = parseRetryableCode(err);
			if (code == null || attempt === MAX_ATTEMPTS - 1) {
				// Non-retryable, or out of attempts. Caller surfaces.
				throw err;
			}
			// Backoff: 400ms, 1.2s. The Oxylabs side often fixes itself
			// on the second try (different upstream IP), so two more
			// attempts is the right balance vs latency.
			await new Promise((r) => setTimeout(r, 400 * 3 ** attempt));
		}
	}
	throw lastErr;
}

/**
 * Returns the retryable upstream code from an Oxylabs adapter error,
 * or null if the error isn't a recognised transient failure (404 from
 * eBay, malformed response, etc.). Exported for testing.
 */
export function parseRetryableCode(err: unknown): number | null {
	if (!(err instanceof Error)) return null;
	const m = err.message.match(/^oxylabs_(?:http|upstream)_(\d+)/);
	if (!m) return null;
	const code = Number.parseInt(m[1] ?? "", 10);
	return Number.isFinite(code) && RETRYABLE_UPSTREAM.has(code) ? code : null;
}

async function callOxylabs(targetUrl: string): Promise<string> {
	const auth = Buffer.from(`${config.SCRAPER_API_USERNAME}:${config.SCRAPER_API_PASSWORD}`).toString("base64");
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
	let res: Response;
	try {
		res = await fetchRetry(ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
			body: JSON.stringify({ source: "universal", url: targetUrl, geo_location: "United States" }),
			signal: ctrl.signal,
		});
	} finally {
		clearTimeout(timer);
	}
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`oxylabs_http_${res.status}: ${text.slice(0, 200)}`);
	}
	const json = (await res.json()) as OxylabsResponse;
	const result = json.results?.[0];
	if (!result) throw new Error("oxylabs_no_results");
	if (result.status_code >= 400) throw new Error(`oxylabs_upstream_${result.status_code}`);
	if (!result.content) throw new Error("oxylabs_empty_content");
	return result.content;
}
