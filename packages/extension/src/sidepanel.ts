/**
 * Side panel — primary UI for the flipagent extension. Lives in the
 * Chrome side-pane (chrome.sidePanel API, Chrome 114+) so it stays open
 * across navigations and feels like a Claude-style assistant rail.
 *
 * Four sections, top to bottom:
 *   1. Header — flipagent brand
 *   2. Status pills — extension paired / buyer signed in / seller OAuth
 *   3. In-flight card (auto-shows) — current buy job with status + cancel
 *   4. Activity feed — live messages from the background service worker
 *   5. Settings (collapsed) — api key + base url + device name
 *
 * No chat input — natural-language orchestration lives in the user's
 * MCP host (Claude Desktop / Cursor). The extension is a status panel
 * + executor, not a command surface.
 */

import {
	clearConfig,
	DEFAULT_BASE_URL,
	fetchConnectStatus,
	getOrderStatus,
	issueBridgeToken,
	loadConfig,
	readBuyerState,
	saveConfig,
} from "./shared.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const eventsEl = () => $<HTMLDivElement>("events");

interface FeedEvent {
	ts: string;
	kind: "info" | "success" | "error";
	message: string;
	detail?: string;
}

const feed: FeedEvent[] = [];
const FEED_MAX = 50;

function addEvent(ev: Omit<FeedEvent, "ts">): void {
	feed.unshift({ ...ev, ts: new Date().toISOString() });
	while (feed.length > FEED_MAX) feed.pop();
	renderFeed();
}

function renderFeed(): void {
	const root = eventsEl();
	if (feed.length === 0) {
		root.innerHTML = `<div class="muted">No activity yet.</div>`;
		return;
	}
	root.innerHTML = feed
		.map((e) => {
			const klass = e.kind === "success" ? "success" : e.kind === "error" ? "error" : "";
			return `<div class="event ${klass}"><span class="ts">${formatTime(e.ts)}</span>${escapeHtml(e.message)}${
				e.detail ? `<pre>${escapeHtml(e.detail)}</pre>` : ""
			}</div>`;
		})
		.join("");
}

function formatTime(iso: string): string {
	const d = new Date(iso);
	return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function escapeHtml(s: string): string {
	return s.replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
	);
}

/* --------------------------------- pills --------------------------------- */

interface RowState {
	dot: "ok" | "warn" | "err" | "idle";
	label: string;
}

function setRow(id: string, state: RowState): void {
	const row = $<HTMLDivElement>(id);
	const dot = row.querySelector(".dot") as HTMLElement | null;
	const label = row.querySelector(".label") as HTMLElement | null;
	if (!dot || !label) return;
	dot.className = `dot ${state.dot}`;
	label.textContent = state.label;
}

async function refreshStatus(): Promise<void> {
	const cfg = await loadConfig();
	if (!cfg.apiKey || !cfg.bridgeToken) {
		setRow("row-paired", { dot: "warn", label: "Not paired — open Settings" });
		setRow("row-buyer", { dot: "idle", label: "—" });
		setRow("row-seller", { dot: "idle", label: "—" });
		$<HTMLDetailsElement>("setup-details").open = true;
		return;
	}
	try {
		const cs = await fetchConnectStatus(cfg);
		setRow("row-paired", {
			dot: cs.bridge.paired ? "ok" : "err",
			label: cs.bridge.paired
				? `Paired as ${cs.bridge.deviceName ?? "?"}${cs.bridge.lastSeenAt ? ` · last seen ${formatTime(cs.bridge.lastSeenAt)}` : ""}`
				: "Not paired",
		});
		setRow("row-buyer", {
			dot: cs.bridge.ebayLoggedIn ? "ok" : "warn",
			label: cs.bridge.ebayLoggedIn
				? `Signed into eBay${cs.bridge.ebayUserName ? ` as ${cs.bridge.ebayUserName}` : ""}`
				: "Not signed into eBay — open ebay.com and sign in",
		});
		setRow("row-seller", {
			dot: cs.oauth.connected ? "ok" : "warn",
			label: cs.oauth.connected
				? `Seller OAuth connected${cs.oauth.ebayUserName ? ` (${cs.oauth.ebayUserName})` : ""}`
				: "Seller OAuth not connected (optional)",
		});
	} catch (err) {
		setRow("row-paired", { dot: "err", label: (err as Error).message });
	}
}

/* ----------------------------- in-flight card ----------------------------- */

interface InFlightSnapshot {
	id: string;
	marketplace: string;
	itemId?: string;
	maxPriceCents?: number | null;
	status: string;
	startedAt: string;
}

const TERMINAL = new Set(["completed", "failed", "cancelled", "expired"]);
let liveOrderPoll: number | null = null;

async function renderInFlight(): Promise<void> {
	const stored = await chrome.storage.local.get(["flipagent_in_flight"]);
	const inFlight = stored.flipagent_in_flight as InFlightSnapshot | undefined;
	const card = $<HTMLDivElement>("now");
	if (!inFlight) {
		card.hidden = true;
		stopLivePoll();
		return;
	}
	card.hidden = false;
	$<HTMLDivElement>("now-item").textContent = inFlight.itemId
		? `${inFlight.marketplace} · ${inFlight.itemId}`
		: inFlight.marketplace;
	$<HTMLSpanElement>("now-status").textContent = inFlight.status;
	const ind = $<HTMLSpanElement>("now-ind");
	ind.className = `ind ${inFlight.status === "completed" ? "ok" : inFlight.status === "failed" ? "err" : "live"}`;
	const meta = inFlight.maxPriceCents != null ? `max $${(inFlight.maxPriceCents / 100).toFixed(2)}` : "—";
	$<HTMLDivElement>("now-meta").textContent = meta;
	startLivePoll(inFlight.id);
}

function startLivePoll(id: string): void {
	stopLivePoll();
	liveOrderPoll = window.setInterval(async () => {
		const cfg = await loadConfig();
		try {
			const o = await getOrderStatus(cfg, id);
			$<HTMLSpanElement>("now-status").textContent = o.status;
			const ind = $<HTMLSpanElement>("now-ind");
			ind.className = `ind ${o.status === "completed" ? "ok" : o.status === "failed" ? "err" : "live"}`;
			const parts: string[] = [];
			if (o.totalCents != null) parts.push(`$${(o.totalCents / 100).toFixed(2)}`);
			if (o.ebayOrderId) parts.push(o.ebayOrderId);
			if (o.failureReason) parts.push(o.failureReason);
			$<HTMLDivElement>("now-meta").textContent = parts.join(" · ");
			if (TERMINAL.has(o.status)) {
				// Background also clears on its end; this just makes the card vanish faster.
				await chrome.storage.local.remove("flipagent_in_flight");
				stopLivePoll();
			}
		} catch (err) {
			$<HTMLDivElement>("now-meta").textContent = (err as Error).message;
		}
	}, 2000);
}

function stopLivePoll(): void {
	if (liveOrderPoll != null) {
		window.clearInterval(liveOrderPoll);
		liveOrderPoll = null;
	}
}

$("now-cancel").addEventListener("click", async () => {
	// Background owns the "cancel + close tab" semantics so the marketplace
	// tab actually goes away (otherwise the user could still click Confirm
	// and pay on a stale tab and bypass our tracking).
	const reply = (await chrome.runtime.sendMessage({ type: "flipagent:cancel-and-close" }).catch(() => null)) as {
		ok: boolean;
		error?: string;
	} | null;
	if (reply?.ok) {
		addEvent({ kind: "info", message: "Cancelled — marketplace tab closed." });
	} else {
		addEvent({ kind: "error", message: "Cancel failed", detail: reply?.error ?? "no response" });
	}
});

chrome.storage.onChanged.addListener((changes, area) => {
	if (area === "local" && "flipagent_in_flight" in changes) {
		void renderInFlight();
	}
});

/* ------------------------------- settings ------------------------------- */

async function renderSetupDefaults(): Promise<void> {
	const cfg = await loadConfig();
	$<HTMLInputElement>("baseUrl").value = cfg.baseUrl ?? DEFAULT_BASE_URL;
	$<HTMLInputElement>("apiKey").value = cfg.apiKey ?? "";
	$<HTMLInputElement>("deviceName").value = cfg.deviceName ?? guessDeviceName();
}

function guessDeviceName(): string {
	const ua = navigator.userAgent;
	if (/Mac/.test(ua)) return "mac";
	if (/Windows/.test(ua)) return "windows";
	if (/Linux/.test(ua)) return "linux";
	return "browser";
}

$("save").addEventListener("click", async () => {
	const apiKey = $<HTMLInputElement>("apiKey").value.trim();
	const baseUrl = $<HTMLInputElement>("baseUrl").value.trim() || DEFAULT_BASE_URL;
	const deviceName = $<HTMLInputElement>("deviceName").value.trim() || guessDeviceName();
	if (!apiKey.startsWith("fa_")) {
		addEvent({ kind: "error", message: "API key must start with `fa_`." });
		return;
	}
	addEvent({ kind: "info", message: `Pairing as "${deviceName}"…` });
	try {
		await saveConfig({ apiKey, baseUrl, deviceName });
		const issued = await issueBridgeToken({ apiKey, baseUrl, deviceName }, deviceName);
		await saveConfig({ bridgeToken: issued.token, bridgeTokenId: issued.id });
		addEvent({ kind: "success", message: `Paired. Bridge token ${issued.prefix}…` });
		// Re-pair = new DB row → wipe local buyer-state cache so next content-script
		// report POSTs fresh login-status to the new bridge token.
		await chrome.storage.local.remove("flipagent_buyer_state").catch(() => {});
		await chrome.runtime.sendMessage({ type: "flipagent:poll-now" }).catch(() => {});
		await refreshStatus();
		$<HTMLDetailsElement>("setup-details").open = false;
	} catch (err) {
		addEvent({ kind: "error", message: "Pair failed", detail: (err as Error).message });
	}
});

$("poll").addEventListener("click", async () => {
	addEvent({ kind: "info", message: "Triggering manual poll…" });
	await chrome.runtime.sendMessage({ type: "flipagent:poll-now" }).catch(() => {});
	await refreshStatus();
});

$("clear").addEventListener("click", async () => {
	if (!confirm("Disconnect this extension from flipagent? You'll need to paste your api key again.")) return;
	await clearConfig();
	addEvent({ kind: "info", message: "Disconnected." });
	await renderSetupDefaults();
	await refreshStatus();
});

/* ------------------------- live feed from background ------------------------- */

chrome.runtime.onMessage.addListener((msg) => {
	if (msg?.type === "flipagent:event") {
		addEvent({
			kind: (msg.kind as FeedEvent["kind"]) ?? "info",
			message: String(msg.message ?? ""),
			detail: msg.detail ? String(msg.detail) : undefined,
		});
		void refreshStatus();
		void renderInFlight();
	}
	return false;
});

/* -------------------------------- bootstrap -------------------------------- */

async function init(): Promise<void> {
	await renderSetupDefaults();
	await refreshStatus();
	await renderInFlight();
	const buyer = await readBuyerState();
	if (buyer) {
		addEvent({
			kind: buyer.loggedIn ? "success" : "info",
			message: buyer.loggedIn
				? `Buyer signed in${buyer.ebayUserName ? ` as ${buyer.ebayUserName}` : ""}`
				: "Buyer not signed in",
			detail: `Last DOM check: ${formatTime(buyer.updatedAt)}`,
		});
	}
}

void init();
