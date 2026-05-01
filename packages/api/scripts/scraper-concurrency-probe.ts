/**
 * Concurrency probe for the configured Web Scraper API (Oxylabs).
 * Sweeps N from a starting point upward, fires N parallel raw POSTs
 * to the Realtime endpoint per round, reports latency distribution +
 * 429 / other error rates. Used to set `MAX_CONCURRENT` in
 * `services/ebay/scrape/scraper-api/oxylabs.ts` to whatever the active
 * account tier actually allows.
 *
 * Bypasses the in-process semaphore so we measure the RAW account cap.
 *
 * Targets cycle through a small pool of distinct, low-cost eBay URLs
 * (item-summary search pages) so Oxylabs does not short-circuit
 * duplicate requests via internal cache.
 *
 * Run: cd packages/api && node --env-file=.env --import tsx scripts/scraper-concurrency-probe.ts [START] [STOP] [STEP]
 *      defaults: 16 50 8
 */

import { config } from "../src/config.js";

const ENDPOINT = "https://realtime.oxylabs.io/v1/queries";
const TIMEOUT_MS = 90_000;

// Cheap, distinct eBay search URLs. Each round picks one per parallel
// slot (cycling) so Oxylabs cannot dedupe-cache responses.
const TARGETS = [
	"https://www.ebay.com/sch/i.html?_nkw=seiko+skx007&_pgn=1",
	"https://www.ebay.com/sch/i.html?_nkw=canon+ae-1&_pgn=1",
	"https://www.ebay.com/sch/i.html?_nkw=nintendo+switch&_pgn=1",
	"https://www.ebay.com/sch/i.html?_nkw=lego+star+wars&_pgn=1",
	"https://www.ebay.com/sch/i.html?_nkw=sony+walkman&_pgn=1",
	"https://www.ebay.com/sch/i.html?_nkw=apple+watch&_pgn=1",
	"https://www.ebay.com/sch/i.html?_nkw=pokemon+card&_pgn=1",
	"https://www.ebay.com/sch/i.html?_nkw=rolex+submariner&_pgn=1",
];

interface Sample {
	durationMs: number;
	ok: boolean;
	httpStatus?: number;
	upstreamStatus?: number;
	errSnippet?: string;
}

function pct(arr: number[], p: number): number {
	if (arr.length === 0) return 0;
	const sorted = [...arr].sort((a, b) => a - b);
	const idx = Math.floor((sorted.length - 1) * p);
	return sorted[idx] ?? 0;
}

async function oneCall(targetUrl: string): Promise<Sample> {
	const t0 = Date.now();
	const auth = Buffer.from(`${config.SCRAPER_API_USERNAME}:${config.SCRAPER_API_PASSWORD}`).toString("base64");
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(ENDPOINT, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
			body: JSON.stringify({ source: "universal", url: targetUrl, geo_location: "United States" }),
			signal: ctrl.signal,
		});
		const text = await res.text();
		const dur = Date.now() - t0;
		if (!res.ok) {
			return { durationMs: dur, ok: false, httpStatus: res.status, errSnippet: text.slice(0, 80) };
		}
		const json = JSON.parse(text) as { results?: Array<{ status_code?: number; content?: string }> };
		const r0 = json.results?.[0];
		if (!r0) return { durationMs: dur, ok: false, errSnippet: "no_results" };
		if ((r0.status_code ?? 0) >= 400) {
			return { durationMs: dur, ok: false, upstreamStatus: r0.status_code };
		}
		if (!r0.content) return { durationMs: dur, ok: false, errSnippet: "empty_content" };
		return { durationMs: dur, ok: true };
	} catch (err) {
		return { durationMs: Date.now() - t0, ok: false, errSnippet: (err as Error).message.slice(0, 80) };
	} finally {
		clearTimeout(timer);
	}
}

async function round(n: number): Promise<Sample[]> {
	const tasks = Array.from({ length: n }, (_, i) => oneCall(TARGETS[i % TARGETS.length]!));
	return Promise.all(tasks);
}

function summarise(n: number, samples: Sample[]): void {
	const ok = samples.filter((s) => s.ok);
	const okMs = ok.map((s) => s.durationMs);
	const errBuckets = new Map<string, number>();
	for (const s of samples) {
		if (s.ok) continue;
		const key =
			s.httpStatus != null
				? `http_${s.httpStatus}`
				: s.upstreamStatus != null
					? `upstream_${s.upstreamStatus}`
					: s.errSnippet ?? "unknown";
		errBuckets.set(key, (errBuckets.get(key) ?? 0) + 1);
	}
	const errSummary =
		errBuckets.size === 0 ? "none" : [...errBuckets.entries()].map(([k, v]) => `${k}=${v}`).join(", ");
	console.log(
		`N=${String(n).padStart(3)}  ok=${ok.length}/${samples.length}` +
			`  p50=${pct(okMs, 0.5)}ms  p95=${pct(okMs, 0.95)}ms  max=${pct(okMs, 1)}ms` +
			`  errors=[${errSummary}]`,
	);
}

async function main(): Promise<void> {
	if (!config.SCRAPER_API_USERNAME || !config.SCRAPER_API_PASSWORD) {
		console.error("scraper creds not set in .env");
		process.exit(1);
	}
	const start = Number.parseInt(process.argv[2] ?? "16", 10);
	const stop = Number.parseInt(process.argv[3] ?? "50", 10);
	const step = Number.parseInt(process.argv[4] ?? "8", 10);
	console.log(`oxylabs concurrency probe: sweep ${start}..${stop} step ${step}, account=${config.SCRAPER_API_USERNAME}`);
	console.log(`endpoint=${ENDPOINT}  targets=${TARGETS.length} cycled  timeout=${TIMEOUT_MS}ms`);
	for (let n = start; n <= stop; n += step) {
		const t0 = Date.now();
		const samples = await round(n);
		const wallMs = Date.now() - t0;
		summarise(n, samples);
		const fail429 = samples.filter((s) => s.httpStatus === 429 || s.upstreamStatus === 429).length;
		console.log(`     wall=${wallMs}ms  http+upstream 429s=${fail429}`);
		if (fail429 >= n / 4) {
			console.log(`     >25% 429s — stopping sweep, current N is past the cap`);
			break;
		}
		// brief breather so back-to-back rounds don't queue inside Oxylabs
		await new Promise((r) => setTimeout(r, 2000));
	}
}

await main().catch((err) => {
	console.error(err);
	process.exit(1);
});
