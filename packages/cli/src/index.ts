#!/usr/bin/env node
/**
 * flipagent-cli — set up flipagent for AI agents AND drive the API
 * straight from your shell. Zero runtime deps — node built-ins only —
 * so `npx -y flipagent-cli` is fast.
 *
 *   flipagent login                      Store your API key (~/.flipagent/config.json)
 *   flipagent logout                     Remove the stored key
 *   flipagent whoami                     Show key prefix + tier + usage
 *
 *   flipagent search <query>             Search active listings
 *   flipagent sold <query>               Search sold listings (last 90 days)
 *   flipagent evaluate <itemId>          Score one listing (composite — server fetches detail + sold + active)
 *   flipagent ship providers             List supported forwarders
 *   flipagent ship quote --item <id> --weight <g> --dest <state>
 *   flipagent buy <itemId>               One-shot BIN through /v1/purchases
 *   flipagent sales list                 Orders received (filterable by --status)
 *   flipagent sales ship <orderId>       Mark shipped + tracking
 *   flipagent payouts list               Payouts history
 *   flipagent transactions list          Per-event finance (sale|refund|fee|adjustment)
 *   flipagent messages list [--type from_ebay|from_members]
 *   flipagent messages thread <id> --type <…>
 *   flipagent messages send (--conversation <id> | --to <user>) --body <text>
 *   flipagent offers list                Best Offers (incoming|outgoing)
 *   flipagent disputes list              Returns / cases / cancellations
 *   flipagent feedback awaiting          Transactions still owed feedback
 *
 *   flipagent init --mcp                 Wire up the local MCP host config.
 *   flipagent --help
 *
 * Auth precedence: --key flag > FLIPAGENT_API_KEY env > stored config.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

/* ────────────────────────────── config store ────────────────────────────── */

interface StoredConfig {
	apiKey?: string;
	baseUrl?: string;
}

const CONFIG_DIR = join(homedir(), ".flipagent");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const DEFAULT_BASE_URL = "https://api.flipagent.dev";

function loadConfig(): StoredConfig {
	if (!existsSync(CONFIG_PATH)) return {};
	try {
		return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as StoredConfig;
	} catch {
		return {};
	}
}

function saveConfig(cfg: StoredConfig): void {
	mkdirSync(CONFIG_DIR, { recursive: true });
	writeFileSync(CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`);
	try {
		// Best-effort 0600 — readable only by user.
		chmodSync(CONFIG_PATH, 0o600);
	} catch {
		// Windows / unusual filesystems — silently skip.
	}
}

function clearConfig(): boolean {
	if (!existsSync(CONFIG_PATH)) return false;
	unlinkSync(CONFIG_PATH);
	return true;
}

function resolveBaseUrl(cfg: StoredConfig): string {
	return process.env.FLIPAGENT_BASE_URL?.trim() || cfg.baseUrl || DEFAULT_BASE_URL;
}

function resolveApiKey(cfg: StoredConfig, override?: string): string {
	const key = override?.trim() || process.env.FLIPAGENT_API_KEY?.trim() || cfg.apiKey?.trim();
	if (!key) {
		throw new Error(
			"No API key found.\n" +
				"  · Hosted:    sign up at https://flipagent.dev/signup, then `flipagent login`\n" +
				"  · Self-host: run `npm run --workspace @flipagent/api issue-key -- you@example.com`,\n" +
				"               then `flipagent login --key fa_… --base-url http://localhost:4000`\n" +
				"  · Ad-hoc:    set FLIPAGENT_API_KEY or pass --key=<value>",
		);
	}
	return key;
}

/* ─────────────────────────────── HTTP layer ─────────────────────────────── */

interface ApiOptions {
	apiKey: string;
	baseUrl: string;
}

async function api<T>(method: "GET" | "POST", path: string, body: unknown, opts: ApiOptions): Promise<T> {
	const url = opts.baseUrl.replace(/\/+$/, "") + path;
	const headers: Record<string, string> = {
		Accept: "application/json",
		Authorization: `Bearer ${opts.apiKey}`,
	};
	const init: RequestInit = { method, headers };
	if (body !== undefined && method !== "GET") {
		headers["Content-Type"] = "application/json";
		init.body = JSON.stringify(body);
	}
	const res = await fetch(url, init);
	const text = await res.text();
	const parsed: unknown = text ? safeJson(text) : undefined;
	if (!res.ok) {
		const detail = typeof parsed === "object" && parsed ? JSON.stringify(parsed) : text.slice(0, 200);
		throw new Error(`HTTP ${res.status} ${path} — ${detail}`);
	}
	return (parsed ?? {}) as T;
}

function safeJson(t: string): unknown {
	try {
		return JSON.parse(t);
	} catch {
		return t;
	}
}

function printJson(value: unknown): void {
	stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/* ──────────────────────────────── arg parser ─────────────────────────────── */

interface ParsedArgs {
	positional: string[];
	flags: Set<string>;
	values: Record<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
	const positional: string[] = [];
	const flags = new Set<string>();
	const values: Record<string, string> = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i] as string;
		if (!a.startsWith("--")) {
			positional.push(a);
			continue;
		}
		const eq = a.indexOf("=");
		if (eq !== -1) {
			values[a.slice(2, eq)] = a.slice(eq + 1);
			continue;
		}
		const next = argv[i + 1];
		if (next !== undefined && !next.startsWith("--")) {
			values[a.slice(2)] = next;
			i++;
		} else {
			flags.add(a);
		}
	}
	return { positional, flags, values };
}

/* ──────────────────────────── login / logout / whoami ───────────────────── */

async function promptApiKey(): Promise<string> {
	if (!stdin.isTTY) {
		throw new Error(
			"No TTY for prompt. Pass --key=<value>, set FLIPAGENT_API_KEY, or run `flipagent login` interactively first.",
		);
	}
	stdout.write(
		"\nNo flipagent API key found.\n" +
			"  · Hosted:    https://flipagent.dev/signup → copy key from dashboard\n" +
			"  · Self-host: `npm run --workspace @flipagent/api issue-key -- you@example.com`\n\n",
	);
	const rl = createInterface({ input: stdin, output: stdout });
	const answer = await rl.question("Paste your flipagent API key (fa_…): ");
	rl.close();
	return answer.trim();
}

async function runLogin(args: ParsedArgs): Promise<void> {
	const baseUrl = args.values.baseUrl ?? args.values["base-url"];
	const key = args.values.key ?? args.values.apiKey ?? (await promptApiKey());
	if (!key) {
		throw new Error(
			"API key is required.\n" +
				"  · Hosted:    sign up at https://flipagent.dev/signup\n" +
				"  · Self-host: `npm run --workspace @flipagent/api issue-key -- you@example.com`",
		);
	}
	// Verify before persisting — wrong keys shouldn't get saved silently.
	const verifyBase = baseUrl ?? DEFAULT_BASE_URL;
	const me = await api<{ tier?: string; usage?: { creditsUsed: number; creditsLimit: number } }>(
		"GET",
		"/v1/keys/me",
		undefined,
		{ apiKey: key, baseUrl: verifyBase },
	).catch((err) => {
		throw new Error(`Could not verify key: ${(err as Error).message}`);
	});
	const cfg: StoredConfig = { apiKey: key };
	if (baseUrl && baseUrl !== DEFAULT_BASE_URL) cfg.baseUrl = baseUrl;
	saveConfig(cfg);
	stdout.write(
		`✓ Stored at ${CONFIG_PATH}\n  tier: ${me.tier ?? "?"}, used: ${me.usage?.creditsUsed ?? "?"}/${me.usage?.creditsLimit ?? "?"}\n`,
	);
}

async function runLogout(): Promise<void> {
	const cleared = clearConfig();
	stdout.write(cleared ? `✓ Removed ${CONFIG_PATH}\n` : "No stored config.\n");
}

async function runWhoami(): Promise<void> {
	const cfg = loadConfig();
	const apiKey = resolveApiKey(cfg);
	const baseUrl = resolveBaseUrl(cfg);
	// Field names match `usageToWire` on the api side (`creditsUsed` /
	// `creditsLimit` / `creditsRemaining` / `resetAt`). `effectiveTier`
	// is set when the billing tier was downgraded for past_due.
	const me = await api<{
		tier?: string;
		usage?: {
			creditsUsed: number;
			creditsLimit: number;
			creditsRemaining?: number;
			resetAt?: string | null;
			effectiveTier?: string;
		};
	}>("GET", "/v1/keys/me", undefined, { apiKey, baseUrl });
	const prefix = `${apiKey.slice(0, 12)}…`;
	const tierStr =
		me.usage?.effectiveTier && me.usage.effectiveTier !== me.tier
			? `${me.tier ?? "?"} (enforced as ${me.usage.effectiveTier})`
			: (me.tier ?? "?");
	stdout.write(
		`key: ${prefix}\nbaseUrl: ${baseUrl}\ntier: ${tierStr}\nusage: ${me.usage?.creditsUsed ?? "?"}/${me.usage?.creditsLimit ?? "?"}\nresets: ${me.usage?.resetAt ?? "?"}\n`,
	);
}

/* ────────────────────────────── doctor ──────────────────────────────────── */

type ScopeStatus = "ok" | "scrape" | "needs_oauth" | "approval_pending" | "unavailable";
type PermissionsResponse = {
	ebayConnected: boolean;
	ebayUserName: string | null;
	scopes: {
		browse: ScopeStatus;
		marketplaceInsights: ScopeStatus;
		inventory: ScopeStatus;
		fulfillment: ScopeStatus;
		finance: ScopeStatus;
		order: ScopeStatus;
		bidding: ScopeStatus;
	};
};

const SCOPE_TITLE: Record<keyof PermissionsResponse["scopes"], string> = {
	browse: "Browse listings",
	marketplaceInsights: "Sold history",
	inventory: "Inventory",
	fulfillment: "Fulfillment",
	finance: "Finance",
	order: "Buy orders",
	bidding: "Auction bids",
};

function formatScope(label: string, status: ScopeStatus): string {
	const mark = status === "ok" ? "✓" : status === "needs_oauth" ? "!" : "·";
	return `  ${mark} ${label.padEnd(28)} ${status}`;
}

async function runDoctor(): Promise<void> {
	const cfg = loadConfig();
	const baseUrl = resolveBaseUrl(cfg);
	stdout.write(`flipagent doctor — ${baseUrl}\n\n`);

	let apiKey: string | null = null;
	try {
		apiKey = resolveApiKey(cfg);
	} catch {
		stdout.write("  · no key stored. Run `flipagent login` first.\n");
		return;
	}
	stdout.write(`  ✓ key: ${apiKey.slice(0, 12)}…\n\n`);

	stdout.write("Per-endpoint access:\n");
	try {
		const perms = await api<PermissionsResponse>("GET", "/v1/keys/permissions", undefined, { apiKey, baseUrl });
		stdout.write(
			perms.ebayConnected
				? `  ✓ eBay connected as @${perms.ebayUserName ?? "?"}\n`
				: "  ! eBay not connected — open the dashboard → Connect eBay account.\n",
		);
		stdout.write(`${formatScope(SCOPE_TITLE.browse, perms.scopes.browse)}\n`);
		stdout.write(`${formatScope(SCOPE_TITLE.marketplaceInsights, perms.scopes.marketplaceInsights)}\n`);
		stdout.write(`${formatScope(SCOPE_TITLE.inventory, perms.scopes.inventory)}\n`);
		stdout.write(`${formatScope(SCOPE_TITLE.fulfillment, perms.scopes.fulfillment)}\n`);
		stdout.write(`${formatScope(SCOPE_TITLE.finance, perms.scopes.finance)}\n`);
		stdout.write(`${formatScope(SCOPE_TITLE.order, perms.scopes.order)}\n`);
		stdout.write(`${formatScope(SCOPE_TITLE.bidding, perms.scopes.bidding)}\n`);
	} catch (err) {
		stdout.write(`  · permissions lookup failed — ${err instanceof Error ? err.message : String(err)}\n`);
	}
}

/* ───────────────────────────── data subcommands ─────────────────────────── */

function clientOpts(args: ParsedArgs): ApiOptions {
	const cfg = loadConfig();
	return { apiKey: resolveApiKey(cfg, args.values.key), baseUrl: resolveBaseUrl(cfg) };
}

async function runSearch(args: ParsedArgs): Promise<void> {
	const q = args.positional[0];
	if (!q) throw new Error("Usage: flipagent search <query> [--limit N] [--filter ...]");
	const opts = clientOpts(args);
	const params = new URLSearchParams({ q });
	if (args.values.limit) params.set("limit", args.values.limit);
	if (args.values.filter) params.set("filter", args.values.filter);
	if (args.values.sort) params.set("sort", args.values.sort);
	const result = await api("GET", `/v1/items/search?${params}`, undefined, opts);
	printJson(result);
}

async function runSold(args: ParsedArgs): Promise<void> {
	const q = args.positional[0];
	if (!q) throw new Error("Usage: flipagent sold <query> [--limit N]");
	const opts = clientOpts(args);
	const params = new URLSearchParams({ q, status: "sold" });
	if (args.values.limit) params.set("limit", args.values.limit);
	const result = await api("GET", `/v1/items/search?${params}`, undefined, opts);
	printJson(result);
}

async function runEvaluate(args: ParsedArgs): Promise<void> {
	const itemId = args.positional[0];
	if (!itemId)
		throw new Error("Usage: flipagent evaluate <itemId> [--lookback-days N] [--sold-limit N] [--min-net <cents>]");
	const opts = clientOpts(args);
	const body: Record<string, unknown> = { itemId };
	const lookback = args.values["lookback-days"] ?? args.values.lookbackDays;
	if (lookback) body.lookbackDays = Number.parseInt(lookback, 10);
	const soldLimit = args.values["sold-limit"] ?? args.values.soldLimit;
	if (soldLimit) body.soldLimit = Number.parseInt(soldLimit, 10);
	const minNet = args.values["min-net"] ?? args.values.minNet;
	if (minNet) body.opts = { minNetCents: Number.parseInt(minNet, 10) };
	const evaluation = await api("POST", "/v1/evaluate", body, opts);
	printJson(evaluation);
}

async function runSales(args: ParsedArgs): Promise<void> {
	const sub = args.positional[0];
	const opts = clientOpts(args);
	if (sub === "list") {
		const params = new URLSearchParams();
		if (args.values.status) params.set("status", args.values.status);
		if (args.values.limit) params.set("limit", args.values.limit);
		const out = await api("GET", `/v1/sales${params.toString() ? `?${params}` : ""}`, undefined, opts);
		printJson(out);
		return;
	}
	if (sub === "ship") {
		const orderId = args.positional[1];
		const tracking = args.values.tracking ?? args.values.trackingNumber;
		const carrier = args.values.carrier;
		if (!orderId || !tracking || !carrier) {
			throw new Error("Usage: flipagent sales ship <orderId> --tracking <num> --carrier <name>");
		}
		const out = await api(
			"POST",
			`/v1/sales/${encodeURIComponent(orderId)}/ship`,
			{ trackingNumber: tracking, carrier },
			opts,
		);
		printJson(out);
		return;
	}
	throw new Error("Usage: flipagent sales <list | ship ...>");
}

async function runPayouts(args: ParsedArgs): Promise<void> {
	const sub = args.positional[0] ?? "list";
	if (sub !== "list") throw new Error("Usage: flipagent payouts list [--limit N]");
	const opts = clientOpts(args);
	const params = new URLSearchParams();
	if (args.values.limit) params.set("limit", args.values.limit);
	const out = await api("GET", `/v1/payouts${params.toString() ? `?${params}` : ""}`, undefined, opts);
	printJson(out);
}

async function runTransactions(args: ParsedArgs): Promise<void> {
	const sub = args.positional[0] ?? "list";
	if (sub !== "list") {
		throw new Error("Usage: flipagent transactions list [--type <sale|refund|fee|adjustment>] [--limit N]");
	}
	const opts = clientOpts(args);
	const params = new URLSearchParams();
	if (args.values.type) params.set("type", args.values.type);
	if (args.values.limit) params.set("limit", args.values.limit);
	if (args.values.payoutId) params.set("payoutId", args.values.payoutId);
	const out = await api("GET", `/v1/transactions${params.toString() ? `?${params}` : ""}`, undefined, opts);
	printJson(out);
}

async function runMessages(args: ParsedArgs): Promise<void> {
	const sub = args.positional[0];
	const opts = clientOpts(args);
	if (sub === "list") {
		const params = new URLSearchParams();
		if (args.values.type) params.set("type", args.values.type);
		if (args.values.limit) params.set("limit", args.values.limit);
		if (args.values.offset) params.set("offset", args.values.offset);
		const out = await api("GET", `/v1/messages${params.toString() ? `?${params}` : ""}`, undefined, opts);
		printJson(out);
		return;
	}
	if (sub === "thread") {
		const id = args.positional[1];
		const type = args.values.type;
		if (!id || !type) {
			throw new Error("Usage: flipagent messages thread <conversationId> --type <from_ebay|from_members>");
		}
		const params = new URLSearchParams({ type });
		if (args.values.limit) params.set("limit", args.values.limit);
		const out = await api("GET", `/v1/messages/${encodeURIComponent(id)}?${params}`, undefined, opts);
		printJson(out);
		return;
	}
	if (sub === "send") {
		const conversationId = args.values.conversation ?? args.values.conversationId;
		const otherPartyUsername = args.values.to ?? args.values.otherParty;
		const messageText = args.values.body ?? args.values.text;
		if (!messageText || (!conversationId && !otherPartyUsername)) {
			throw new Error(
				"Usage: flipagent messages send (--conversation <id> | --to <username>) --body <text> [--listing <itemId>]",
			);
		}
		const payload: Record<string, unknown> = { messageText };
		if (conversationId) payload.conversationId = conversationId;
		if (otherPartyUsername) payload.otherPartyUsername = otherPartyUsername;
		if (args.values.listing) {
			payload.reference = { referenceType: "listing", referenceId: args.values.listing };
		}
		const out = await api("POST", "/v1/messages", payload, opts);
		printJson(out);
		return;
	}
	throw new Error("Usage: flipagent messages <list | thread | send>");
}

async function runOffers(args: ParsedArgs): Promise<void> {
	const sub = args.positional[0] ?? "list";
	if (sub !== "list") throw new Error("Usage: flipagent offers list [--direction <in|out>] [--status <s>]");
	const opts = clientOpts(args);
	const params = new URLSearchParams();
	if (args.values.direction) params.set("direction", args.values.direction);
	if (args.values.status) params.set("status", args.values.status);
	if (args.values.limit) params.set("limit", args.values.limit);
	const out = await api("GET", `/v1/offers${params.toString() ? `?${params}` : ""}`, undefined, opts);
	printJson(out);
}

async function runDisputes(args: ParsedArgs): Promise<void> {
	const sub = args.positional[0] ?? "list";
	if (sub !== "list") throw new Error("Usage: flipagent disputes list [--status <s>] [--type <t>]");
	const opts = clientOpts(args);
	const params = new URLSearchParams();
	if (args.values.status) params.set("status", args.values.status);
	if (args.values.type) params.set("type", args.values.type);
	if (args.values.limit) params.set("limit", args.values.limit);
	const out = await api("GET", `/v1/disputes${params.toString() ? `?${params}` : ""}`, undefined, opts);
	printJson(out);
}

async function runFeedback(args: ParsedArgs): Promise<void> {
	const sub = args.positional[0];
	const opts = clientOpts(args);
	if (sub === "awaiting") {
		const out = await api("GET", "/v1/feedback/awaiting", undefined, opts);
		printJson(out);
		return;
	}
	if (sub === "list") {
		const params = new URLSearchParams();
		if (args.values.role) params.set("role", args.values.role);
		if (args.values.rating) params.set("rating", args.values.rating);
		if (args.values.limit) params.set("limit", args.values.limit);
		const out = await api("GET", `/v1/feedback${params.toString() ? `?${params}` : ""}`, undefined, opts);
		printJson(out);
		return;
	}
	throw new Error("Usage: flipagent feedback <awaiting | list ...>");
}

async function runBuy(args: ParsedArgs): Promise<void> {
	const itemId = args.positional[0];
	if (!itemId) throw new Error("Usage: flipagent buy <itemId> [--quantity N] [--variation <id>]");
	const opts = clientOpts(args);
	const quantity = args.values.quantity ? Number.parseInt(args.values.quantity, 10) : 1;
	const item: Record<string, unknown> = { itemId, quantity };
	if (args.values.variation ?? args.values.variationId) {
		item.variationId = args.values.variation ?? args.values.variationId;
	}
	const out = await api("POST", "/v1/purchases", { items: [item] }, opts);
	printJson(out);
}

async function runShip(args: ParsedArgs): Promise<void> {
	const sub = args.positional[0];
	const opts = clientOpts(args);
	if (sub === "providers") {
		const out = await api("GET", "/v1/ship/providers", undefined, opts);
		printJson(out);
		return;
	}
	if (sub === "quote") {
		const itemId = args.values.item ?? args.values.itemId;
		const weight = args.values.weight ?? args.values.weightG;
		const dest = args.values.dest ?? args.values.destState;
		if (!itemId || !weight || !dest) {
			throw new Error("Usage: flipagent ship quote --item <id> --weight <g> --dest <state> [--provider <id>]");
		}
		const item = await api<unknown>("GET", `/v1/items/${encodeURIComponent(itemId)}`, undefined, opts);
		const forwarder: Record<string, unknown> = { destState: dest, weightG: Number.parseInt(weight, 10) };
		if (args.values.provider) forwarder.provider = args.values.provider;
		const out = await api("POST", "/v1/ship/quote", { item, forwarder }, opts);
		printJson(out);
		return;
	}
	throw new Error("Usage: flipagent ship <providers | quote ...>");
}

/* ──────────────────────────── init (MCP installer) ─────────────────────── */

interface ClientTarget {
	name: string;
	configPath: string;
}

function detectClients(): ClientTarget[] {
	const home = homedir();
	const os = platform();

	const claudeDesktopPath =
		os === "darwin"
			? join(home, "Library/Application Support/Claude/claude_desktop_config.json")
			: os === "win32"
				? join(process.env.APPDATA ?? join(home, "AppData/Roaming"), "Claude/claude_desktop_config.json")
				: join(home, ".config/Claude/claude_desktop_config.json");

	// Claude Code keeps user-level MCP settings in `~/.claude.json` (the
	// `mcpServers` key sits alongside other CLI config). It's our primary
	// host — try it first.
	const claudeCodePath = join(home, ".claude.json");

	return [
		{ name: "Claude Code", configPath: claudeCodePath },
		{ name: "Claude Desktop", configPath: claudeDesktopPath },
	];
}

interface McpConfig {
	mcpServers?: Record<string, McpServerEntry>;
	[k: string]: unknown;
}
interface McpServerEntry {
	command: string;
	args?: string[];
	env?: Record<string, string>;
}

function loadMcpJson(path: string): McpConfig {
	if (!existsSync(path)) return {};
	const txt = readFileSync(path, "utf-8");
	if (!txt.trim()) return {};
	return JSON.parse(txt) as McpConfig;
}

function backupOnce(path: string): void {
	const bak = `${path}.bak`;
	if (existsSync(path) && !existsSync(bak)) {
		writeFileSync(bak, readFileSync(path));
	}
}

function mergeFlipagentEntry(config: McpConfig, apiKey: string, baseUrl: string | undefined): McpConfig {
	const next: McpConfig = { ...config };
	const servers: Record<string, McpServerEntry> = { ...(next.mcpServers ?? {}) };
	const env: Record<string, string> = { FLIPAGENT_API_KEY: apiKey };
	// Only include FLIPAGENT_BASE_URL when the user is on a non-default host
	// (self-host or staging). Hosted users get the same shape as before so
	// re-running `init --mcp` is idempotent and doesn't gratuitously diff.
	if (baseUrl && baseUrl !== DEFAULT_BASE_URL) env.FLIPAGENT_BASE_URL = baseUrl;
	servers.flipagent = {
		command: "npx",
		args: ["-y", "flipagent-mcp"],
		env,
	};
	next.mcpServers = servers;
	return next;
}

async function runInit(args: ParsedArgs): Promise<void> {
	const wantMcp = args.flags.has("--mcp") || (!args.flags.has("--keys") && !args.values.key);
	const cfg = loadConfig();
	let apiKey: string;
	try {
		apiKey = resolveApiKey(cfg, args.values.key);
	} catch {
		apiKey = await promptApiKey();
	}
	if (!apiKey) throw new Error("API key is required. Get one at https://flipagent.dev/signup");

	if (!wantMcp) {
		stdout.write("API key captured. Pass --mcp to also write client configs.\n");
		return;
	}

	// Honor a non-default base URL (set via `flipagent login --base-url …` or
	// FLIPAGENT_BASE_URL) so MCP clients on self-host installs talk to the
	// right api. Hosted users (default api.flipagent.dev) get the same shape as before.
	const baseUrl = resolveBaseUrl(cfg);

	const targets = detectClients();
	let configured = 0;
	let skipped = 0;
	for (const t of targets) {
		const dirExists = existsSync(dirname(t.configPath));
		const fileExists = existsSync(t.configPath);
		if (!dirExists && !fileExists) {
			stdout.write(`(skipped ${t.name}: not detected at ${t.configPath})\n`);
			skipped++;
			continue;
		}
		try {
			const existing = loadMcpJson(t.configPath);
			const next = mergeFlipagentEntry(existing, apiKey, baseUrl);
			backupOnce(t.configPath);
			mkdirSync(dirname(t.configPath), { recursive: true });
			writeFileSync(t.configPath, `${JSON.stringify(next, null, 2)}\n`);
			stdout.write(`✓ ${t.name}: ${t.configPath}\n`);
			configured++;
		} catch (err) {
			stdout.write(`✗ ${t.name}: ${(err as Error).message}\n`);
		}
	}

	if (configured === 0) {
		stdout.write(
			"\nNo MCP host config was found on this machine.\n" +
				"Copy the manual snippet from https://flipagent.dev/docs/mcp/ instead.\n",
		);
		process.exit(1);
	}
	stdout.write(
		`\nConfigured ${configured} client${configured === 1 ? "" : "s"}` +
			(skipped > 0 ? ` (skipped ${skipped})` : "") +
			". Restart the client to load flipagent.\n",
	);
}

/* ──────────────────────────────────── help ─────────────────────────────── */

function printHelp(): void {
	stdout.write(`flipagent-cli — set up flipagent + drive the API from your shell.

Auth:
  flipagent login [--key <value>] [--base-url <url>]
                                      Verify and store the API key (~/.flipagent/config.json).
  flipagent logout                    Remove the stored key.
  flipagent whoami                    Show key prefix + tier + monthly usage.
  flipagent doctor                    Diagnose the host (which features are wired)
                                      + your key (which scopes you can call).

Data — sourcing + decisions (uses stored key, env, or --key):
  flipagent search <query> [--limit N] [--filter <expr>] [--sort <key>]
  flipagent sold <query> [--limit N]
  flipagent evaluate <itemId> [--lookback-days N] [--sold-limit N] [--min-net <cents>]
  flipagent ship providers
  flipagent ship quote --item <id> --weight <g> --dest <state> [--provider <id>]

Buy:
  flipagent buy <itemId> [--quantity N] [--variation <id>]

Sell + finance:
  flipagent sales list [--status paid|shipped|delivered|refunded|cancelled] [--limit N]
  flipagent sales ship <orderId> --tracking <num> --carrier <name>
  flipagent payouts list [--limit N]
  flipagent transactions list [--type sale|refund|fee|adjustment] [--payout-id <id>] [--limit N]

Buyer comms + post-sale:
  flipagent messages list [--type from_ebay|from_members] [--limit N]
  flipagent messages thread <conversationId> --type from_ebay|from_members
  flipagent messages send (--conversation <id> | --to <username>) --body <text> [--listing <itemId>]
  flipagent offers list [--direction incoming|outgoing] [--status pending|accepted|...]
  flipagent disputes list [--status open|awaiting_seller|...] [--type return|cancellation|inr|snad|inquiry]
  flipagent feedback awaiting
  flipagent feedback list [--role buyer|seller] [--rating positive|neutral|negative]

Setup:
  flipagent init [--mcp] [--keys] [--key <value>]
                                      Detect the local MCP host config
                                      and write the flipagent entry.

Buy-side execution (/v1/purchases) runs in two transports — REST
passthrough (with eBay Buy Order API approval) or the flipagent
Chrome extension (runs inside your existing Chrome session; you
click Buy It Now and Confirm-and-pay yourself, the way eBay's
policy requires). Extension install + setup:
https://flipagent.dev/docs/extension/

Get a free key (1,000 credits one-time, no card) at https://flipagent.dev/signup.
Self-hosting? See https://flipagent.dev/docs/self-host/.
`);
}

/* ─────────────────────────────────── main ───────────────────────────────── */

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
		printHelp();
		return;
	}
	const command = argv[0];
	const rest = argv.slice(1);
	const args = parseArgs(rest);
	switch (command) {
		case "login":
			await runLogin(args);
			return;
		case "logout":
			await runLogout();
			return;
		case "whoami":
			await runWhoami();
			return;
		case "doctor":
			await runDoctor();
			return;
		case "search":
			await runSearch(args);
			return;
		case "sold":
			await runSold(args);
			return;
		case "evaluate":
			await runEvaluate(args);
			return;
		case "ship":
			await runShip(args);
			return;
		case "buy":
			await runBuy(args);
			return;
		case "sales":
			await runSales(args);
			return;
		case "payouts":
			await runPayouts(args);
			return;
		case "transactions":
			await runTransactions(args);
			return;
		case "messages":
			await runMessages(args);
			return;
		case "offers":
			await runOffers(args);
			return;
		case "disputes":
			await runDisputes(args);
			return;
		case "feedback":
			await runFeedback(args);
			return;
		case "init":
			await runInit(args);
			return;
		case "daemon":
			stdout.write(
				"`flipagent daemon` was removed. Buy-side execution runs through\n" +
					"`/v1/purchases` — the response either places the order or returns\n" +
					"`nextAction.url` for the user to complete on the marketplace UI.\n" +
					"Optional Chrome extension adds in-page UX: https://flipagent.dev/docs/extension/\n",
			);
			process.exit(1);
			return; // unreachable after process.exit, kept to satisfy no-fallthrough
		default:
			stdout.write(`unknown command: ${command}\n\n`);
			printHelp();
			process.exit(1);
	}
}

main().catch((err: unknown) => {
	process.stderr.write(`flipagent: ${(err as Error).message ?? err}\n`);
	process.exit(1);
});
