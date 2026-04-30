/**
 * MV3 service worker — runs the bridge longpoll loop and dispatches jobs
 * to the content script in an ebay.com tab.
 *
 * Cadence:
 *   - chrome.alarms fires every 30 seconds.
 *   - Each tick: GET /v1/bridge/poll with a 25-second client-side timeout.
 *     - 200 + job payload → open / focus an ebay.com tab, hand off to content.
 *     - 204 → idle, do nothing.
 *   - We also probe eBay cookies once per tick and POST /v1/bridge/login-status
 *     when the buyer signed-in state changes — keeps the connect-status
 *     surface fresh without a separate sign-in UX.
 *
 * No automation flags get set in the user's Chrome (we ARE the user's
 * Chrome). Akamai sees a normal session.
 */

import type { BridgeJobStatus, BridgePollJob, BridgeResultRequest } from "@flipagent/types";
import { runEbayQuery } from "./ebay-query.js";
import {
	apiCall,
	type ExtensionConfig,
	loadConfig,
	pollForJob,
	readBuyerState,
	reportLoginStatus,
	reportResult,
	saveConfig,
	writeBuyerState,
} from "./shared.js";

const POLL_ALARM = "flipagent-poll";
const POLL_PERIOD_MIN = 0.5; // 30 s — MV3 alarms minimum is 30 s in production
const POLL_TIMEOUT_MS = 25_000;

/* ------------------------------- alarm setup ------------------------------- */

chrome.runtime.onInstalled.addListener(() => {
	chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_PERIOD_MIN });
});
chrome.runtime.onStartup.addListener(() => {
	chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_PERIOD_MIN });
});
chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm.name === POLL_ALARM) void tick().catch((err) => console.error("[flipagent] tick error:", err));
});

/** Broadcast an activity event to the popup (and any other extension UI). */
function emit(kind: "info" | "success" | "error", message: string, detail?: string): void {
	void chrome.runtime.sendMessage({ type: "flipagent:event", kind, message, detail }).catch(() => {
		// Popup may be closed — drop silently.
	});
}

// Messages from popup / content script.
chrome.runtime.onMessage.addListener((msg, _sender, send) => {
	if (msg?.type === "flipagent:poll-now") {
		void tick()
			.then(() => send({ ok: true }))
			.catch((err) => send({ ok: false, error: String(err) }));
		return true; // async response
	}
	if (msg?.type === "flipagent:buyer-state") {
		void onBuyerStateUpdate(msg.loggedIn, msg.ebayUserName).then(() => send({ ok: true }));
		return true;
	}
	if (msg?.type === "flipagent:order-progress") {
		// Content script reports a state transition (placing, completed, failed).
		// Forward to /v1/bridge/result; clear in-flight on terminal.
		void onOrderProgress(msg.body as BridgeResultRequest).then(() => send({ ok: true }));
		return true;
	}
	if (msg?.type === "flipagent:cancel-and-close") {
		// Side panel asked to abort an in-flight buy: mark cancelled at
		// the API, drop in-flight, AND close the marketplace tab so the
		// user can't absent-mindedly click Confirm and pay.
		void onCancelAndClose().then((r) => send(r));
		return true;
	}
	return false;
});

async function onCancelAndClose(): Promise<{ ok: boolean; error?: string }> {
	const cfg = await loadConfig();
	const stored = await chrome.storage.local.get(["flipagent_in_flight"]);
	const inFlight = stored.flipagent_in_flight as { id: string; marketplace: string } | undefined;
	if (!inFlight) return { ok: true }; // already gone
	try {
		// 1. cancel via API. eBay's Buy Order REST has no cancel endpoint;
		//    the route is bridge-transport only and force-bridge is fine
		//    here because the extension is itself the bridge.
		await apiCall(cfg, `/v1/buy/order/purchase_order/${encodeURIComponent(inFlight.id)}/cancel`, {
			method: "POST",
			auth: "apiKey",
			timeoutMs: 10_000,
		}).catch((err) => console.warn("[flipagent] cancel POST failed:", err));
		// 2. close any tabs on the relevant marketplace so the user
		//    can't accidentally complete the purchase.
		const matchPattern = tabMatchPatternFor(inFlight.marketplace);
		if (matchPattern) {
			const tabs = await chrome.tabs.query({ url: matchPattern });
			for (const t of tabs) {
				if (t.id !== undefined) await chrome.tabs.remove(t.id).catch(() => {});
			}
		}
		// 3. clear local snapshot. (Background also clears on terminal
		//    `flipagent:order-progress`; this just makes the popup react
		//    instantly without round-tripping the API.)
		await chrome.storage.local.remove("flipagent_in_flight");
		emit("info", "Order cancelled & tab closed");
		return { ok: true };
	} catch (err) {
		const error = (err as Error).message ?? String(err);
		return { ok: false, error };
	}
}

function tabMatchPatternFor(marketplace: string): string | null {
	if (marketplace === "ebay") return "https://*.ebay.com/*";
	if (marketplace === "planetexpress") return "https://*.planetexpress.com/*";
	return null;
}

const TERMINAL_OUTCOMES = new Set(["completed", "failed", "cancelled", "expired"]);

async function onOrderProgress(body: BridgeResultRequest): Promise<void> {
	const cfg = await loadConfig();
	if (!cfg.bridgeToken) return;
	await reportResult(cfg, body).catch((err) => console.warn("[flipagent] order-progress report failed:", err));
	emit(
		body.outcome === "completed" ? "success" : body.outcome === "failed" ? "error" : "info",
		`Order ${body.outcome}${body.totalCents != null ? ` ($${(body.totalCents / 100).toFixed(2)})` : ""}`,
		body.failureReason ?? body.ebayOrderId ?? undefined,
	);
	if (TERMINAL_OUTCOMES.has(body.outcome)) {
		await chrome.storage.local.remove("flipagent_in_flight").catch(() => {});
	}
}

async function onBuyerStateUpdate(loggedIn: boolean, ebayUserName: string | undefined): Promise<void> {
	const cfg = await loadConfig();
	if (!cfg.bridgeToken) return;
	const prior = await readBuyerState();
	const changed = !prior || prior.loggedIn !== loggedIn || prior.ebayUserName !== ebayUserName;
	await writeBuyerState({ loggedIn, ebayUserName, updatedAt: new Date().toISOString() });

	// IMPORTANT order: POST to API FIRST, then emit. The panel re-fetches
	// `/v1/connect/ebay/status` on every emit, so emitting before the API
	// row is updated produces a flicker where the activity feed says
	// "Buyer signed in" while the status pill still reads "not signed in".
	// Always POST — the API row may be fresh from a re-pair regardless of
	// whether the extension's local snapshot changed.
	await reportLoginStatus(cfg, { loggedIn, ebayUserName }).catch((err) =>
		console.warn("[flipagent] login-status report failed:", err),
	);
	if (changed) {
		emit(
			loggedIn ? "success" : "info",
			loggedIn ? `Buyer signed in${ebayUserName ? ` as ${ebayUserName}` : ""}` : "Buyer signed out",
		);
	}
}

/* ---------------------------------- tick ---------------------------------- */

async function tick(): Promise<void> {
	const cfg = await loadConfig();
	if (!cfg.apiKey || !cfg.bridgeToken) {
		// Not configured yet; skip silently. Options page nudges the user.
		return;
	}

	// Buyer-session is updated reactively by the content script on each
	// ebay.com page load (see content.ts → flipagent:buyer-state). The
	// service worker no longer probes it from here — fetches from the SW
	// don't get the user's SameSite-protected eBay cookies, which made
	// every probe falsely report "not logged in".

	let job: BridgePollJob | null = null;
	try {
		job = await withTimeout(pollForJob(cfg), POLL_TIMEOUT_MS);
	} catch (err) {
		const msg = (err as Error).message ?? String(err);
		if (!msg.includes("timeout") && !msg.includes("AbortError")) {
			console.warn("[flipagent] poll error:", msg);
		}
		return;
	}
	if (!job) return; // 204 — idle

	// Meta task: agent asked the extension to reload itself (e.g. after a
	// dist rebuild during interactive selector iteration). Skip the order
	// machinery — we don't want a purchase_orders row hanging around.
	if (job.task === "reload_extension") {
		emit("info", "Reload requested by agent — restarting extension");
		// Best-effort: clear in-flight if any leftover, then reload. The
		// SW dies during reload — the API never gets a result, but the
		// purchase_order's expires_at sweeps it out.
		await chrome.storage.local.remove("flipagent_in_flight").catch(() => {});
		setTimeout(() => chrome.runtime.reload(), 250);
		return;
	}

	// Generic browser primitive: forward to the active (or matching) tab's
	// content script for execution, then post the result back. Doesn't
	// touch in-flight storage — these are quick sync ops, not long buys.
	if (job.task === "browser_op") {
		await runBrowserOp(cfg, job);
		return;
	}

	// Bridge transport for eBay public-data reads. SW fetches the user's
	// search/detail/sold page directly (their cookies + IP), parses with
	// the shared scraper, and reports the structured result. No tab.
	if (job.task === "ebay_query") {
		await runEbayQueryTask(cfg, job);
		return;
	}

	console.log("[flipagent] picked up job", job.jobId, "item", job.args.itemId, job.args.marketplace);
	await chrome.storage.local.set({
		flipagent_in_flight: {
			id: job.jobId,
			marketplace: job.args.marketplace,
			itemId: job.args.itemId,
			maxPriceCents: job.args.maxPriceCents,
			status: "claimed",
			startedAt: new Date().toISOString(),
		},
	});
	emit("info", `Picked up ${job.args.marketplace} buy for ${job.args.itemId}`, `jobId=${job.jobId}`);
	try {
		await dispatchJob(cfg, job);
	} catch (err) {
		const failureReason = `dispatcher_failed: ${(err as Error).message ?? String(err)}`;
		await chrome.storage.local.remove("flipagent_in_flight").catch(() => {});
		emit("error", "Dispatcher failed", failureReason);
		await reportResult(cfg, { jobId: job.jobId, outcome: "failed" as BridgeJobStatus, failureReason }).catch(
			() => {},
		);
	}
}

// (refreshBuyerStateIfChanged removed — content-script DOM check replaces SW fetch probe.)
void saveConfig; // suppress unused-import noise; saveConfig is used elsewhere indirectly

/* ----------------------------- job dispatch ----------------------------- */
/* Interactive model: we open / focus the marketplace tab and let the
 * content script take over. Content script is a stateless observer —
 * it shows banners, validates against `maxPriceCents`, and reports
 * progress (placing, completed, failed) via `flipagent:order-progress`
 * messages. The user does every click. No `execute-job` round-trip. */

/**
 * Execute a `browser_op` job by sending the args to a content script
 * in the active tab (or a tab matching `args.metadata.tabUrlPattern`).
 * Wait for the content script's response, then post it as the bridge
 * result so the API's sync wait can return inline.
 */
async function runEbayQueryTask(cfg: ExtensionConfig, job: BridgePollJob): Promise<void> {
	try {
		const meta = (job.args.metadata ?? {}) as Record<string, unknown>;
		const result = await runEbayQuery(meta);
		await reportResult(cfg, {
			jobId: job.jobId,
			outcome: "completed",
			result: result as Record<string, unknown>,
		});
	} catch (err) {
		await reportResult(cfg, {
			jobId: job.jobId,
			outcome: "failed",
			failureReason: `ebay_query_failed: ${(err as Error).message ?? String(err)}`,
		}).catch(() => {});
	}
}

async function runBrowserOp(cfg: ExtensionConfig, job: BridgePollJob): Promise<void> {
	try {
		const meta = (job.args.metadata ?? {}) as Record<string, unknown>;
		const tabPattern = typeof meta.tabUrlPattern === "string" ? meta.tabUrlPattern : null;
		let tab: chrome.tabs.Tab | undefined;
		if (tabPattern) {
			const tabs = await chrome.tabs.query({ url: tabPattern });
			tab = tabs[0];
		}
		if (!tab) {
			const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
			tab = active;
		}
		if (!tab?.id) throw new Error("no_target_tab");

		const reply = await sendToTabWithInjectFallback(tab.id, {
			type: "flipagent:browser-op",
			args: job.args,
		});
		if (!reply) throw new Error("content_script_no_reply");
		await reportResult(cfg, {
			jobId: job.jobId,
			outcome: "completed",
			result: reply as Record<string, unknown>,
		});
	} catch (err) {
		await reportResult(cfg, {
			jobId: job.jobId,
			outcome: "failed",
			failureReason: `browser_op_failed: ${(err as Error).message}`,
		}).catch(() => {});
	}
}

/**
 * Send a message to a tab's content script, falling back to
 * `chrome.scripting.executeScript` to inject content.js when the tab
 * has no listener yet (common after the extension auto-reloads — the
 * SW restarted with new code but already-open tabs still run the
 * pre-reload content script). One injection per missing tab; future
 * messages reach the new listener without re-injection.
 */
async function sendToTabWithInjectFallback(tabId: number, msg: unknown): Promise<unknown> {
	try {
		return await chrome.tabs.sendMessage(tabId, msg);
	} catch (err) {
		const errMsg = (err as Error).message ?? String(err);
		if (!/Could not establish connection|Receiving end does not exist/i.test(errMsg)) {
			throw err;
		}
		// Inject content.js then retry once.
		await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
		// Give the content script a tick to wire up its message listener.
		await new Promise((r) => setTimeout(r, 200));
		return await chrome.tabs.sendMessage(tabId, msg);
	}
}

async function dispatchJob(cfg: ExtensionConfig, job: BridgePollJob): Promise<void> {
	const url = itemUrlFor(job.args.marketplace, job.args.itemId);
	if (!url) {
		await chrome.storage.local.remove("flipagent_in_flight").catch(() => {});
		await reportResult(cfg, {
			jobId: job.jobId,
			outcome: "failed",
			failureReason: `unsupported_marketplace: ${job.args.marketplace}`,
		});
		return;
	}
	const tab = await ensureMarketplaceTab(job.args.marketplace, url);
	if (tab.id === undefined) throw new Error("could not open marketplace tab");
	// Content script's observer runs on document_idle and reads
	// `flipagent_in_flight` from storage to know what to do. No further
	// work here — progress comes back via onOrderProgress.
}

function itemUrlFor(marketplace: string, itemId: string | null | undefined): string | null {
	if (marketplace === "ebay") return itemId ? `https://www.ebay.com/itm/${encodeURIComponent(itemId)}` : null;
	if (marketplace === "planetexpress") {
		// `pull_packages` lands on the actual inbox table page.
		return "https://app.planetexpress.com/client/packet/";
	}
	return null;
}

async function ensureMarketplaceTab(marketplace: string, url: string): Promise<chrome.tabs.Tab> {
	// Re-use a tab whose URL is on the same marketplace's item path.
	const matchPattern =
		marketplace === "ebay"
			? "https://www.ebay.com/itm/*"
			: marketplace === "planetexpress"
				? "https://app.planetexpress.com/*"
				: url;
	const existing = await chrome.tabs.query({ url: matchPattern });
	const target = existing[0];
	if (target?.id !== undefined) {
		// `chrome.tabs.update` throws "Tabs cannot be edited right now (user
		// may be dragging a tab)" if the user is mid-drag, has a modal
		// dialog open, or has the tab in a transient state. Fall back to
		// creating a new tab — slightly worse UX (extra tab opens) but
		// always works.
		try {
			await chrome.tabs.update(target.id, { active: true, url });
			return target;
		} catch (err) {
			console.warn("[flipagent] tabs.update failed, falling back to new tab:", err);
		}
	}
	return chrome.tabs.create({ url, active: true });
}

/* ------------------------------ small utils ------------------------------ */

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const t = setTimeout(() => reject(new Error("timeout")), ms);
		p.then((v) => {
			clearTimeout(t);
			resolve(v);
		}).catch((e: unknown) => {
			clearTimeout(t);
			reject(e instanceof Error ? e : new Error(String(e)));
		});
	});
}

// Suppress unused-import lint when apiCall is referenced indirectly via reportResult etc.
void apiCall;
