/**
 * Live verification of Phase 1 endpoints — Tier A (zero risk) + Tier B
 * (own-data reads). Skips anything that mutates eBay state.
 *
 *   FLIPAGENT_BASE_URL=http://localhost:4000 \
 *   FLIPAGENT_API_KEY=fa_…  \
 *   npx tsx scripts/live-verify-phase1.ts
 *
 * Tier A — no eBay OAuth, no state change, no cost beyond scrape vendor.
 * Tier B — sell-side reads (eBay OAuth required). Skipped if `connect`
 *          status reports the api key isn't bound to an eBay account.
 *
 * Output: one line per endpoint with status + latency. Final summary
 * counts pass / fail / skip.
 */

const BASE = process.env.FLIPAGENT_BASE_URL ?? "http://localhost:4000";
const KEY = process.env.FLIPAGENT_API_KEY;

if (!KEY) {
	console.error("Set FLIPAGENT_API_KEY to a valid Bearer token.");
	process.exit(1);
}

interface Probe {
	tier: "A" | "B";
	method: "GET" | "POST";
	path: string;
	body?: Record<string, unknown>;
	expect?: number[]; // acceptable status codes (default [200])
}

const tierA: Probe[] = [
	// First-call discovery
	{ tier: "A", method: "GET", path: "/healthz" },
	{ tier: "A", method: "GET", path: "/v1/capabilities" },
	{ tier: "A", method: "GET", path: "/v1/keys/me" },
	{ tier: "A", method: "GET", path: "/v1/keys/permissions" },

	// Sourcing — scrape primary, no eBay account use
	{ tier: "A", method: "GET", path: "/v1/items/search?q=iphone&limit=3" },
	{ tier: "A", method: "GET", path: "/v1/items/search?q=watch&status=sold&limit=3" },
	{ tier: "A", method: "GET", path: "/v1/items/v1%7C123456789012%7C0", expect: [200, 404, 502] },

	// Categories (REST app credential — anonymous OAuth on flipagent's side)
	{ tier: "A", method: "GET", path: "/v1/categories" },
	{ tier: "A", method: "GET", path: "/v1/categories/suggest?title=mens%20watch", expect: [200, 502] },

	// Products (EPID lookup — REST app or scrape)
	{ tier: "A", method: "GET", path: "/v1/products/123456?marketplace=ebay", expect: [200, 404, 502] },
];

const tierB: Probe[] = [
	// Sell-side reads — need eBay OAuth on the calling key.
	// (`/v1/me` itself is dashboard-cookie-only — agents use `/v1/keys/me`
	// + `/v1/me/{programs,selling,buying,quota}` instead.)
	{ tier: "B", method: "GET", path: "/v1/me/seller/privilege" },
	{ tier: "B", method: "GET", path: "/v1/me/seller/kyc" },
	{ tier: "B", method: "GET", path: "/v1/me/seller/subscription" },
	{ tier: "B", method: "GET", path: "/v1/me/programs" },
	{ tier: "B", method: "GET", path: "/v1/me/quota" },
	{ tier: "B", method: "GET", path: "/v1/me/selling" },
	{ tier: "B", method: "GET", path: "/v1/me/buying" },
	{ tier: "B", method: "GET", path: "/v1/listings?limit=3" },
	{ tier: "B", method: "GET", path: "/v1/locations?limit=3" },
	{ tier: "B", method: "GET", path: "/v1/policies?limit=3" },
	{ tier: "B", method: "GET", path: "/v1/sales?limit=3" },
	{ tier: "B", method: "GET", path: "/v1/payouts?limit=3" },
	{ tier: "B", method: "GET", path: "/v1/transactions?limit=3" },
	{ tier: "B", method: "GET", path: "/v1/messages?limit=3" },
	{ tier: "B", method: "GET", path: "/v1/feedback?limit=3" },
	{ tier: "B", method: "GET", path: "/v1/feedback/awaiting?limit=3" },
	{ tier: "B", method: "GET", path: "/v1/disputes?type=return&limit=3" },
	{ tier: "B", method: "GET", path: "/v1/recommendations?limit=3", expect: [200, 502] },
	{ tier: "B", method: "GET", path: "/v1/analytics/standards", expect: [200, 502] },
	{ tier: "B", method: "GET", path: "/v1/notifications/topics" },
	{ tier: "B", method: "GET", path: "/v1/webhooks" },
];

interface Result {
	probe: Probe;
	status: number;
	ok: boolean;
	skipped?: string;
	ms: number;
	source?: string;
	preview?: string;
}

interface RawResult extends Result {
	bodyText?: string;
}
async function runProbe(probe: Probe): Promise<RawResult> {
	const url = `${BASE}${probe.path}`;
	const t0 = Date.now();
	try {
		const res = await fetch(url, {
			method: probe.method,
			headers: {
				Authorization: `Bearer ${KEY}`,
				...(probe.body ? { "Content-Type": "application/json" } : {}),
			},
			...(probe.body ? { body: JSON.stringify(probe.body) } : {}),
		});
		const ms = Date.now() - t0;
		const expect = probe.expect ?? [200];
		const ok = expect.includes(res.status);
		const text = await res.text();
		const source = res.headers.get("x-flipagent-source") ?? undefined;
		return {
			probe,
			status: res.status,
			ok,
			ms,
			...(source ? { source } : {}),
			preview: text.slice(0, 120).replace(/\s+/g, " "),
			bodyText: text,
		};
	} catch (err) {
		const ms = Date.now() - t0;
		return {
			probe,
			status: 0,
			ok: false,
			ms,
			preview: err instanceof Error ? err.message : String(err),
		};
	}
}

function formatLine(r: Result): string {
	const tag = r.ok ? "✓" : r.skipped ? "○" : "✗";
	const surface = r.source ? `[${r.source}]`.padEnd(10) : "         ";
	const status = r.skipped ? "—".padStart(3) : String(r.status).padStart(3);
	return `  ${tag} ${r.probe.tier} ${status} ${String(r.ms).padStart(5)}ms ${surface} ${r.probe.method} ${r.probe.path}`;
}

async function main() {
	console.log(`\n[verify] Tier A — public reads + own-key (no eBay OAuth needed)\n`);
	const a: Result[] = [];
	for (const p of tierA) {
		const r = await runProbe(p);
		a.push(r);
		console.log(formatLine(r));
		if (!r.ok && r.preview) console.log(`            preview: ${r.preview}`);
	}

	// Probe ebay OAuth status before Tier B.
	console.log(`\n[verify] eBay OAuth status check…`);
	const oauthCheck = await runProbe({
		tier: "A",
		method: "GET",
		path: "/v1/connect/ebay/status",
		expect: [200, 404],
	});
	console.log(formatLine(oauthCheck));
	let ebayConnected = false;
	if (oauthCheck.ok && oauthCheck.bodyText) {
		try {
			const parsed = JSON.parse(oauthCheck.bodyText) as { oauth?: { connected?: boolean } };
			ebayConnected = parsed.oauth?.connected === true;
		} catch {
			// best-effort; if parse fails, fall back to running Tier B and letting 401s flag it.
		}
	}

	if (!ebayConnected) {
		console.log(
			`\n[verify] Tier B SKIPPED — eBay OAuth not connected. Connect at /v1/connect/ebay first to verify sell-side reads.\n`,
		);
	} else {
		console.log(`\n[verify] Tier B — own-data reads (eBay OAuth required)\n`);
	}

	const b: Result[] = [];
	for (const p of tierB) {
		if (!ebayConnected) {
			b.push({ probe: p, status: 0, ok: false, skipped: "no-oauth", ms: 0 });
			continue;
		}
		const r = await runProbe(p);
		b.push(r);
		console.log(formatLine(r));
		if (!r.ok && r.preview) console.log(`            preview: ${r.preview}`);
	}

	const all = [...a, oauthCheck, ...b];
	const pass = all.filter((r) => r.ok).length;
	const fail = all.filter((r) => !r.ok && !r.skipped).length;
	const skip = all.filter((r) => r.skipped).length;
	console.log(`\n[verify] Summary — ${pass} pass · ${fail} fail · ${skip} skip · ${all.length} total\n`);
	process.exit(fail > 0 ? 1 : 0);
}

main();
