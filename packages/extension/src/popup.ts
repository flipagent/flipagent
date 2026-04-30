/**
 * Popup — primary UI for the flipagent extension. Renders in the
 * toolbar action popup (chrome.action.default_popup) so it opens on
 * icon click, closes on outside click, and stays compact (~360px).
 *
 * The headline is a single status banner that funnels the user toward
 * exactly one next step at a time: "paste API key" → "Pair this
 * device" → "Sign into eBay" → "Ready". Three orthogonal connection
 * axes (this browser pair, eBay session, seller API) are still
 * tracked from /v1/connect/ebay/status, but distilled into one
 * obvious action — detail rows live behind a Connection details
 * collapsible for debugging.
 *
 * Auto-pair: when an api key is configured but no bridge token has
 * been issued for this Chrome instance, the popup quietly issues
 * one on init. Users never need to remember a pair step — they just
 * paste a key.
 *
 * No chat input — natural-language orchestration lives in the user's
 * MCP host (Claude Desktop / Cursor / Claude Code). The popup is a
 * status panel + executor control surface, not a command surface.
 *
 * State note: chrome popups unmount on close, so every open re-runs
 * `init()`. Cheap (one /v1/connect status fetch + one storage read);
 * no streaming connections to keep alive.
 */

import {
	clearConfig,
	DEFAULT_BASE_URL,
	type ExtensionConfig,
	fetchConnectStatus,
	getOrderStatus,
	issueBridgeToken,
	loadConfig,
	saveConfig,
} from "./shared.js";

type ConnectStatus = Awaited<ReturnType<typeof fetchConnectStatus>>;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const eventsEl = () => $<HTMLDivElement>("events");

/* ------------------------------ feed buffer ------------------------------ */

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
		root.innerHTML = `<div class="hp-empty">No activity yet. Queue a job from your MCP host (Claude Desktop / Cursor) — it lands here.</div>`;
		return;
	}
	root.innerHTML = feed
		.map((e) => {
			const klass = e.kind === "success" ? "success" : e.kind === "error" ? "error" : "info";
			return `<div class="hp-event ${e.kind === "error" ? "error" : ""}"><span class="hp-event-dot ${klass}"></span><span class="hp-event-ts">${formatTime(e.ts)}</span><div class="hp-event-msg">${escapeHtml(e.message)}${
				e.detail ? `<span class="hp-event-detail">${escapeHtml(e.detail)}</span>` : ""
			}</div></div>`;
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

/* ------------------------------- banner -------------------------------- */

/**
 * Distilled state for the headline banner. The popup has exactly one
 * primary status at a time so the user is never asked to interpret
 * three independent dots — they see the most actionable next step.
 */
type BannerState =
	| { kind: "loading" }
	| { kind: "needs_api_key" }
	| { kind: "pairing"; deviceName: string }
	| { kind: "needs_pair"; deviceName: string }
	| { kind: "stale"; deviceName: string; lastSeenAt: string }
	| { kind: "needs_signin" }
	| { kind: "ready"; sellerName: string | null; ebayUserName: string | null }
	| { kind: "error"; message: string };

const STALE_BRIDGE_MS = 5 * 60_000;

function deriveBannerState(cfg: ExtensionConfig, cs: ConnectStatus | null, fetchErr: Error | null): BannerState {
	if (!cfg.apiKey) return { kind: "needs_api_key" };
	if (fetchErr) return { kind: "error", message: fetchErr.message };
	if (!cs) return { kind: "loading" };
	if (!cs.bridge.paired) {
		return { kind: "needs_pair", deviceName: cfg.deviceName ?? guessDeviceName() };
	}
	const last = cs.bridge.lastSeenAt ? Date.parse(cs.bridge.lastSeenAt) : 0;
	if (last && Date.now() - last > STALE_BRIDGE_MS) {
		return { kind: "stale", deviceName: cs.bridge.deviceName ?? "this browser", lastSeenAt: cs.bridge.lastSeenAt! };
	}
	if (!cs.bridge.ebayLoggedIn) return { kind: "needs_signin" };
	return {
		kind: "ready",
		sellerName: cs.oauth.connected ? cs.oauth.ebayUserName : null,
		ebayUserName: cs.bridge.ebayUserName,
	};
}

function renderBanner(state: BannerState): void {
	const dot = $<HTMLSpanElement>("banner-dot");
	const headline = $<HTMLSpanElement>("banner-headline");
	const context = $<HTMLDivElement>("banner-context");
	const cta = $<HTMLButtonElement>("banner-cta");

	switch (state.kind) {
		case "loading":
			dot.className = "hp-banner-dot live";
			headline.textContent = "Checking status…";
			context.textContent = "";
			cta.hidden = true;
			cta.textContent = "";
			cta.onclick = null;
			break;
		case "pairing":
			dot.className = "hp-banner-dot live";
			headline.textContent = "Pairing this browser…";
			context.textContent = `Registering "${state.deviceName}" with flipagent.`;
			cta.hidden = true;
			cta.textContent = "";
			cta.onclick = null;
			break;
		case "needs_api_key":
			dot.className = "hp-banner-dot warn";
			headline.textContent = "Connect your API key";
			context.textContent = "Paste a flipagent API key from your dashboard.";
			cta.hidden = false;
			cta.textContent = "Open Settings";
			cta.onclick = () => openSettings();
			break;
		case "needs_pair":
			dot.className = "hp-banner-dot warn";
			headline.textContent = "Pair this browser";
			context.textContent = `One click to register "${state.deviceName}" as a bridge client.`;
			cta.hidden = false;
			cta.textContent = "Pair this device";
			cta.onclick = () => void autoPair();
			break;
		case "stale":
			dot.className = "hp-banner-dot warn";
			headline.textContent = "Bridge not polling";
			context.textContent = `Last seen ${formatTime(state.lastSeenAt)}. Reload Chrome or trigger a manual poll.`;
			cta.hidden = false;
			cta.textContent = "Poll now";
			cta.onclick = () => void manualPoll();
			break;
		case "needs_signin":
			dot.className = "hp-banner-dot warn";
			headline.textContent = "Sign into eBay";
			context.textContent = "Open ebay.com in this Chrome and sign in — the extension auto-detects.";
			cta.hidden = false;
			cta.textContent = "Open ebay.com";
			cta.onclick = () => {
				void chrome.tabs.create({ url: "https://www.ebay.com/" });
			};
			break;
		case "ready": {
			dot.className = "hp-banner-dot ok";
			headline.textContent = "Ready";
			// Dedupe when buyer == seller (same eBay account behind both
			// access mechanisms). Keep the line minimal — one identity
			// is enough.
			const buyer = state.ebayUserName?.trim() ?? null;
			const seller = state.sellerName?.trim() ?? null;
			let line = "Bridge polling for jobs.";
			if (buyer && seller && buyer === seller) line = `Connected as ${buyer}`;
			else if (buyer && seller) line = `Buyer ${buyer} · Seller ${seller}`;
			else if (buyer) line = `Buyer ${buyer}`;
			else if (seller) line = `Seller ${seller}`;
			context.textContent = line;
			cta.hidden = true;
			cta.textContent = "";
			cta.onclick = null;
			break;
		}
		case "error":
			dot.className = "hp-banner-dot err";
			headline.textContent = "Couldn't reach flipagent";
			context.textContent = state.message;
			cta.hidden = false;
			cta.textContent = "Retry";
			cta.onclick = () => void refresh();
			break;
	}
}

function openSettings(): void {
	$<HTMLDetailsElement>("setup-details").open = true;
	$<HTMLInputElement>("apiKey").focus();
}

async function manualPoll(): Promise<void> {
	addEvent({ kind: "info", message: "Triggering manual poll…" });
	await chrome.runtime.sendMessage({ type: "flipagent:poll-now" }).catch(() => {});
	await refresh();
}

/* ------------------------------ detail rows ------------------------------ */

interface RowState {
	dot: "ok" | "warn" | "err" | "idle";
	detail: string;
}

function setRow(id: string, state: RowState): void {
	const row = $<HTMLLIElement>(id);
	const dot = row.querySelector(".hp-dot") as HTMLElement | null;
	const detail = row.querySelector(".hp-row-detail") as HTMLElement | null;
	if (!dot || !detail) return;
	dot.className = `hp-dot ${state.dot}`;
	detail.textContent = state.detail;
}

function renderDetailRows(cs: ConnectStatus | null): void {
	if (!cs) {
		setRow("row-paired", { dot: "idle", detail: "—" });
		setRow("row-buyer", { dot: "idle", detail: "—" });
		setRow("row-seller", { dot: "idle", detail: "—" });
		return;
	}
	setRow("row-paired", {
		dot: cs.bridge.paired ? "ok" : "warn",
		detail: cs.bridge.paired
			? `${cs.bridge.deviceName ?? "?"}${cs.bridge.lastSeenAt ? ` · ${formatTime(cs.bridge.lastSeenAt)}` : ""}`
			: "Not paired",
	});
	setRow("row-buyer", {
		dot: cs.bridge.ebayLoggedIn ? "ok" : "warn",
		detail: cs.bridge.ebayLoggedIn ? `${cs.bridge.ebayUserName ?? "Signed in"}` : "Not signed in",
	});
	setRow("row-seller", {
		dot: cs.oauth.connected ? "ok" : "idle",
		detail: cs.oauth.connected ? `${cs.oauth.ebayUserName ?? "Connected"}` : "Optional",
	});
}

/* ------------------------------ refresh tick ----------------------------- */

async function refresh(): Promise<void> {
	const cfg = await loadConfig();
	if (!cfg.apiKey) {
		renderBanner({ kind: "needs_api_key" });
		renderDetailRows(null);
		$<HTMLDetailsElement>("setup-details").open = true;
		return;
	}
	let cs: ConnectStatus | null = null;
	let err: Error | null = null;
	try {
		cs = await fetchConnectStatus(cfg);
	} catch (e) {
		err = e as Error;
	}
	renderBanner(deriveBannerState(cfg, cs, err));
	renderDetailRows(cs);
}

/* ------------------------------- auto-pair ------------------------------- */

let pairing = false;

/**
 * Issue a bridge token silently when one is missing. Called both from
 * the explicit "Pair this device" CTA and from the popup's init flow
 * when an api key is set but no bridge token exists locally — users
 * shouldn't have to remember a separate "pair" step.
 */
async function autoPair(): Promise<void> {
	if (pairing) return;
	pairing = true;
	const cfg = await loadConfig();
	if (!cfg.apiKey) {
		pairing = false;
		return;
	}
	const deviceName = cfg.deviceName ?? guessDeviceName();
	// Banner reflects the in-progress step so the user can see what's
	// happening without looking at the activity feed. The feed gets
	// only the terminal entry (success / failure) — no noise from
	// in-progress chatter.
	renderBanner({ kind: "pairing", deviceName });
	try {
		const issued = await issueBridgeToken(cfg, deviceName);
		await saveConfig({ bridgeToken: issued.token, bridgeTokenId: issued.id, deviceName });
		await chrome.storage.local.remove("flipagent_buyer_state").catch(() => {});
		await chrome.runtime.sendMessage({ type: "flipagent:poll-now" }).catch(() => {});
		addEvent({ kind: "success", message: `Paired as "${deviceName}".` });
		await refresh();
	} catch (err) {
		const message = (err as Error).message ?? String(err);
		addEvent({ kind: "error", message: "Pair failed", detail: message });
		renderBanner({ kind: "error", message });
	} finally {
		pairing = false;
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

const TERMINAL = new Set<string>(["PROCESSED", "FAILED", "CANCELED"]);
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
	ind.className = `hp-ind ${inFlight.status === "completed" ? "ok" : inFlight.status === "failed" ? "err" : "live"}`;
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
			$<HTMLSpanElement>("now-status").textContent = o.purchaseOrderStatus;
			const ind = $<HTMLSpanElement>("now-ind");
			ind.className = `hp-ind ${o.purchaseOrderStatus === "PROCESSED" ? "ok" : o.purchaseOrderStatus === "FAILED" ? "err" : "live"}`;
			const parts: string[] = [];
			const total = o.pricingSummary?.total?.value;
			if (total) parts.push(`$${Number.parseFloat(total).toFixed(2)}`);
			if (o.ebayOrderId) parts.push(o.ebayOrderId);
			if (o.failureReason) parts.push(o.failureReason);
			$<HTMLDivElement>("now-meta").textContent = parts.join(" · ");
			if (TERMINAL.has(o.purchaseOrderStatus)) {
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
	await saveConfig({ apiKey, baseUrl, deviceName });
	await autoPair();
	$<HTMLDetailsElement>("setup-details").open = false;
});

$("poll").addEventListener("click", () => void manualPoll());

$("clear").addEventListener("click", async () => {
	if (!confirm("Disconnect this extension from flipagent? You'll need to paste your api key again.")) return;
	await clearConfig();
	addEvent({ kind: "info", message: "Disconnected." });
	await renderSetupDefaults();
	await refresh();
});

/* ------------------------- live feed from background ------------------------- */

chrome.runtime.onMessage.addListener((msg) => {
	if (msg?.type === "flipagent:event") {
		addEvent({
			kind: (msg.kind as FeedEvent["kind"]) ?? "info",
			message: String(msg.message ?? ""),
			detail: msg.detail ? String(msg.detail) : undefined,
		});
		void refresh();
		void renderInFlight();
	}
	return false;
});

/* -------------------------------- bootstrap -------------------------------- */

async function init(): Promise<void> {
	await renderSetupDefaults();
	renderBanner({ kind: "loading" });

	const cfg = await loadConfig();
	// Auto-pair on open: if the user has an api key but no bridge
	// token, silently issue one before the first status fetch. Saves
	// the user from a separate "pair" step.
	if (cfg.apiKey && !cfg.bridgeToken) {
		await autoPair();
	} else {
		await refresh();
	}
	await renderInFlight();
}

void init();
