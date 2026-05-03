/**
 * Spawns flipagent-mcp over stdio + replays a realistic agent walkthrough
 * via the MCP JSON-RPC protocol. Confirms:
 *
 *   1. server boots + responds to `initialize`
 *   2. `tools/list` returns the Phase 1 set
 *   3. `tools/call` for each Tier-A tool round-trips through the MCP
 *      protocol → SDK → flipagent api → eBay (or scrape) → reply
 *
 * Run:
 *   FLIPAGENT_BASE_URL=http://localhost:4001 \
 *   FLIPAGENT_API_KEY=fa_… \
 *   npx tsx packages/mcp/scripts/smoke-mcp.ts
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const BASE = process.env.FLIPAGENT_BASE_URL ?? "http://localhost:4001";
const KEY = process.env.FLIPAGENT_API_KEY;
if (!KEY) {
	console.error("Set FLIPAGENT_API_KEY.");
	process.exit(1);
}

const child = spawn(process.execPath, ["packages/mcp/dist/index.js"], {
	stdio: ["pipe", "pipe", "inherit"],
	env: { ...process.env, FLIPAGENT_BASE_URL: BASE, FLIPAGENT_API_KEY: KEY },
});
const rl = createInterface({ input: child.stdout });

let nextId = 1;
const pending = new Map<number, (msg: unknown) => void>();
rl.on("line", (line) => {
	if (!line.trim()) return;
	let msg: { id?: number };
	try {
		msg = JSON.parse(line);
	} catch {
		return;
	}
	if (msg.id != null && pending.has(msg.id)) {
		const cb = pending.get(msg.id)!;
		pending.delete(msg.id);
		cb(msg);
	}
});

function send(method: string, params: Record<string, unknown> = {}): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
	const id = nextId++;
	return new Promise((resolve) => {
		pending.set(id, resolve as (m: unknown) => void);
		child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
	});
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<{ ok: boolean; preview: string }> {
	const t0 = Date.now();
	const res = await send("tools/call", { name, arguments: args });
	const ms = Date.now() - t0;
	const r = res as { result?: { content?: Array<{ text?: string }>; isError?: boolean }; error?: { message?: string } };
	if (r.error) return { ok: false, preview: `err ${ms}ms — ${r.error.message ?? ""}` };
	const text = r.result?.content?.[0]?.text ?? "";
	const preview = text.slice(0, 90).replace(/\s+/g, " ");
	return { ok: !r.result?.isError, preview: `${ms}ms — ${preview}` };
}

async function main() {
	console.log("[smoke-mcp] initialize…");
	const init = (await send("initialize", {
		protocolVersion: "2024-11-05",
		capabilities: {},
		clientInfo: { name: "smoke-mcp", version: "0.0.1" },
	})) as { result?: { protocolVersion?: string } };
	console.log("  ✓ protocolVersion:", init.result?.protocolVersion);

	child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

	console.log("\n[smoke-mcp] tools/list…");
	const list = (await send("tools/list")) as { result?: { tools?: Array<{ name: string }> } };
	const tools = list.result?.tools ?? [];
	console.log(`  ✓ ${tools.length} tools registered`);
	const expected = [
		"flipagent_get_capabilities",
		"flipagent_get_my_key",
		"flipagent_search_items",
		"flipagent_search_sold_items",
		"flipagent_evaluate_item",
		"flipagent_get_ebay_connection",
		"flipagent_create_listing",
	];
	for (const e of expected) {
		const found = tools.some((t) => t.name === e);
		console.log(`  ${found ? "✓" : "✗"} expects ${e}`);
	}

	console.log("\n[smoke-mcp] tools/call — Tier A walkthrough\n");
	const probes: Array<[string, Record<string, unknown>]> = [
		["flipagent_get_capabilities", {}],
		["flipagent_get_my_key", {}],
		["flipagent_get_ebay_connection", {}],
		["flipagent_search_items", { q: "iphone", limit: 3 }],
		["flipagent_search_sold_items", { q: "watch", limit: 3 }],
		["flipagent_list_categories", {}],
		["flipagent_suggest_category", { title: "mens watch" }],
	];
	let pass = 0;
	let fail = 0;
	for (const [name, args] of probes) {
		const r = await call(name, args);
		console.log(`  ${r.ok ? "✓" : "✗"} ${name.padEnd(36)} ${r.preview}`);
		if (r.ok) pass++;
		else fail++;
	}

	console.log(`\n[smoke-mcp] Summary — ${pass} pass · ${fail} fail · ${probes.length} total\n`);
	child.kill();
	process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
	console.error("[smoke-mcp] error:", err);
	child.kill();
	process.exit(1);
});
