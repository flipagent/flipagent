#!/usr/bin/env node
/**
 * Fake-extension test harness for `/v1/bridge/*`.
 *
 * Replays the exact request/response shape the real Chrome extension
 * sends, without needing a browser. Useful for:
 *   - exercising the bridge protocol contract end-to-end on local dev
 *   - smoke-testing a new bridge endpoint before shipping the extension
 *   - reproducing a failing job by hand
 *
 * State is kept in `~/.flipagent/test-harness.json` so each subcommand
 * is independent (you can step through interactively from another
 * terminal, a Claude Code conversation, a CI script, etc.).
 *
 *   Subcommands:
 *     pair               POST /v1/bridge/tokens         (api-key auth)
 *     login [user]       POST /v1/bridge/login-status   (bridge-token auth)
 *     poll               GET  /v1/bridge/poll           (bridge-token auth) — single-shot
 *     result <jobId> <outcome> [--ebayOrderId X] [--reason X]
 *                        POST /v1/bridge/result         (bridge-token auth)
 *     queue <itemId> [--max <cents>]
 *                        POST /v1/buy/order/checkout_session/initiate
 *                        + POST /.../{sessionId}/place_order        (api-key auth) — convenience
 *     status <orderId>   GET  /v1/buy/order/purchase_order/{id}     (api-key auth) — convenience
 *     show               print harness state
 *     reset              wipe harness state
 *
 * Env:
 *   FLIPAGENT_BASE_URL   default http://localhost:4001
 *   FLIPAGENT_API_KEY    required for `pair` / `queue` / `status`
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = (process.env.FLIPAGENT_BASE_URL || "http://localhost:4001").replace(/\/+$/, "");
const KEY = process.env.FLIPAGENT_API_KEY;
const STATE_DIR = join(homedir(), ".flipagent");
const STATE_PATH = join(STATE_DIR, "test-harness.json");

function loadState() {
	if (!existsSync(STATE_PATH)) return {};
	try {
		return JSON.parse(readFileSync(STATE_PATH, "utf8"));
	} catch {
		return {};
	}
}
function saveState(s) {
	if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
	writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

function die(msg) {
	console.error(`[fake-ext] ${msg}`);
	process.exit(1);
}

async function http(method, path, opts = {}) {
	const headers = { "Content-Type": "application/json", ...(opts.headers ?? {}) };
	const r = await fetch(`${BASE}${path}`, {
		method,
		headers,
		body: opts.body ? JSON.stringify(opts.body) : undefined,
	});
	const text = await r.text();
	let body;
	try { body = text ? JSON.parse(text) : null; } catch { body = text; }
	return { status: r.status, body };
}

async function pair() {
	if (!KEY) die("FLIPAGENT_API_KEY not set.");
	const r = await http("POST", "/v1/bridge/tokens", {
		headers: { Authorization: `Bearer ${KEY}` },
		body: { deviceName: "fake-ext-harness" },
	});
	if (r.status !== 201) die(`pair failed: HTTP ${r.status} ${JSON.stringify(r.body)}`);
	const state = loadState();
	state.bridgeToken = r.body.token;
	state.bridgeTokenId = r.body.id;
	state.bridgeTokenPrefix = r.body.prefix;
	saveState(state);
	console.log(`[fake-ext] paired. tokenPrefix=${r.body.prefix} (saved to ${STATE_PATH})`);
}

async function login(args) {
	const state = loadState();
	if (!state.bridgeToken) die("not paired. Run `pair` first.");
	const userArg = args.find((a) => !a.startsWith("--"));
	const loggedIn = !args.includes("--false");
	const r = await http("POST", "/v1/bridge/login-status", {
		headers: { Authorization: `Bearer ${state.bridgeToken}` },
		body: { loggedIn, ebayUserName: userArg ?? "fake-ext-buyer" },
	});
	if (r.status !== 200) die(`login-status failed: HTTP ${r.status} ${JSON.stringify(r.body)}`);
	console.log(`[fake-ext] login-status posted. loggedIn=${loggedIn} user=${userArg ?? "fake-ext-buyer"}`);
}

async function poll() {
	const state = loadState();
	if (!state.bridgeToken) die("not paired. Run `pair` first.");
	console.log(`[fake-ext] polling… (server holds up to ~25s)`);
	const r = await http("GET", "/v1/bridge/poll", {
		headers: { Authorization: `Bearer ${state.bridgeToken}` },
	});
	if (r.status === 204) {
		console.log("[fake-ext] 204 — idle window, no job. Re-run to keep polling.");
		return;
	}
	if (r.status !== 200) die(`poll failed: HTTP ${r.status} ${JSON.stringify(r.body)}`);
	console.log("[fake-ext] 200 — claimed job:");
	console.log(JSON.stringify(r.body, null, 2));
	state.lastJob = r.body;
	saveState(state);
}

async function result(args) {
	const state = loadState();
	if (!state.bridgeToken) die("not paired. Run `pair` first.");
	const [jobId, outcome, ...rest] = args;
	if (!jobId || !outcome) die("usage: result <jobId> <outcome>");
	const flags = Object.fromEntries(
		rest.reduce((acc, _v, i, arr) => {
			if (i % 2 === 0 && arr[i].startsWith("--")) acc.push([arr[i].slice(2), arr[i + 1]]);
			return acc;
		}, []),
	);
	const body = {
		jobId,
		outcome,
		...(flags.ebayOrderId ? { ebayOrderId: flags.ebayOrderId } : {}),
		...(flags.totalCents ? { totalCents: Number(flags.totalCents) } : {}),
		...(flags.receiptUrl ? { receiptUrl: flags.receiptUrl } : {}),
		...(flags.reason ? { failureReason: flags.reason } : {}),
		...(flags.result ? { result: JSON.parse(flags.result) } : {}),
	};
	const r = await http("POST", "/v1/bridge/result", {
		headers: { Authorization: `Bearer ${state.bridgeToken}` },
		body,
	});
	if (r.status !== 200) die(`result failed: HTTP ${r.status} ${JSON.stringify(r.body)}`);
	console.log(`[fake-ext] result posted. outcome=${outcome}`);
}

async function queue(args) {
	if (!KEY) die("FLIPAGENT_API_KEY not set.");
	const [itemId] = args;
	if (!itemId) die("usage: queue <itemId> [--max <cents>]");
	// `--max` was a flipagent-side cap; the eBay-shape surface has no
	// equivalent (the bridge enforces cap from the original metadata,
	// not a passthrough field), so it's accepted-and-ignored here.
	const auth = { Authorization: `Bearer ${KEY}` };
	const initiate = await http("POST", "/v1/buy/order/checkout_session/initiate", {
		headers: auth,
		body: { lineItems: [{ itemId, quantity: 1 }] },
	});
	if (initiate.status !== 200)
		die(`initiate failed: HTTP ${initiate.status} ${JSON.stringify(initiate.body)}`);
	const sessionId = initiate.body.checkoutSessionId;
	const place = await http("POST", `/v1/buy/order/checkout_session/${encodeURIComponent(sessionId)}/place_order`, {
		headers: auth,
		body: {},
	});
	if (place.status !== 200) die(`place_order failed: HTTP ${place.status} ${JSON.stringify(place.body)}`);
	const state = loadState();
	state.lastOrderId = place.body.purchaseOrderId;
	saveState(state);
	console.log(
		`[fake-ext] queued. purchaseOrderId=${place.body.purchaseOrderId} status=${place.body.purchaseOrderStatus}`,
	);
}

async function status(args) {
	if (!KEY) die("FLIPAGENT_API_KEY not set.");
	const [orderId] = args;
	const id = orderId ?? loadState().lastOrderId;
	if (!id) die("usage: status <orderId> (or run `queue` first to set lastOrderId)");
	const r = await http("GET", `/v1/buy/order/purchase_order/${encodeURIComponent(id)}`, {
		headers: { Authorization: `Bearer ${KEY}` },
	});
	if (r.status !== 200) die(`status failed: HTTP ${r.status} ${JSON.stringify(r.body)}`);
	console.log(JSON.stringify(r.body, null, 2));
}

function show() {
	console.log("baseUrl:", BASE);
	console.log("apiKey:", KEY ? KEY.slice(0, 12) + "…" : "<unset>");
	console.log("state:", JSON.stringify(loadState(), null, 2));
}

function reset() {
	if (existsSync(STATE_PATH)) rmSync(STATE_PATH);
	console.log(`[fake-ext] state cleared (${STATE_PATH}).`);
}

const [, , cmd, ...rest] = process.argv;
const handlers = { pair, login, poll, result, queue, status, show, reset };
const fn = handlers[cmd];
if (!fn) {
	console.error(`Usage: node fake-ext.mjs <pair|login|poll|result|queue|status|show|reset> [args]`);
	process.exit(1);
}
Promise.resolve(fn(rest)).catch((err) => {
	console.error("[fake-ext] error:", err.message ?? err);
	process.exit(1);
});
