/**
 * Oxylabs Web Scraper API adapter. Realtime endpoint: POST a URL,
 * Basic auth, get rendered HTML in `results[0].content`. Oxylabs
 * handles the full anti-bot stack on their side.
 */

import { config } from "../../config.js";
import { fetchRetry } from "../../utils/fetch-retry.js";

interface OxylabsResult {
	content: string;
	status_code: number;
	url: string;
}

interface OxylabsResponse {
	results?: OxylabsResult[];
}

const ENDPOINT = "https://realtime.oxylabs.io/v1/queries";
const TIMEOUT_MS = 60_000;

export async function fetchHtmlViaOxylabs(targetUrl: string): Promise<string> {
	if (!config.SCRAPER_API_USERNAME || !config.SCRAPER_API_PASSWORD) {
		throw new Error("scraper_api_not_configured");
	}
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
