/**
 * Popup — toolbar UI. Two persistent sections:
 *
 *   1. **Setup** — 4-row checklist that derives status from
 *      `/v1/capabilities` + chrome.storage mirrors (eBay buyer state,
 *      Planet Express session). Same view every popup-open: completed
 *      rows show ✓, the next undone row is highlighted with a CTA, locked
 *      rows are dimmed. Collapses to a single "All set" summary once
 *      every step is done.
 *
 *      Steps in order:
 *        a. Pair this Chrome           — paste API key (in-row form)
 *        b. Sign in to eBay            — opens ebay.com
 *        c. Connect seller account     — opens dashboard?connect=ebay
 *        d. Set up Planet Express      — opens app.planetexpress.com
 *
 *   2. **Now** — live list of in-flight async work (buy job + running
 *      evaluates), driven by chrome.storage mirrors.
 *
 * One canonical state read per render: `loadConfig()` + `fetchCapabilities()`
 * (cached 30s) + chrome.storage local-mirror reads. The previous
 * single-banner mutating state machine is gone.
 */

import type { CapabilitiesResponse, SetupStep } from "@flipagent/types";
import { MESSAGES } from "./messages.js";
import {
	clearConfig,
	DEFAULT_DASHBOARD_BASE_URL,
	type ExtensionConfig,
	fetchCapabilities,
	loadConfig,
} from "./shared.js";
import { RUNNING_MIRROR_TTL_MS, type RunningEvalEntry, readBuyerState, STORAGE_KEYS } from "./storage.js";
import { DASHBOARD_PATHS, dashboardUrl } from "./urls.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/* ------------------------------ checklist ------------------------------ */
/* The server's `/v1/capabilities.checklist` is the single source of truth
 * for step ids + status + required-vs-optional. The popup only adds
 * (a) per-step CTAs that depend on Chrome APIs, (b) the inline paste
 * form for the pair step, and (c) a chrome.storage overlay for PE
 * login state (no server-side column yet). */

type StepStatus = "done" | "active" | "locked";

interface StepRow {
	id: string;
	status: StepStatus;
	required: boolean;
	title: string;
	sub: string;
	cta: { label: string; onClick: () => void } | null;
}

function adornStep(
	step: SetupStep,
	overlay: { ebayUserName: string | null; deviceName: string | null; dashboardBase: string },
): StepRow {
	const status: StepStatus = step.status;
	let title = shortTitle(step);
	let cta: { label: string; onClick: () => void } | null = null;

	switch (step.id) {
		case "pair_extension":
			if (status === "done") title = "Paired";
			if (status === "active") {
				cta = {
					label: "Sign in",
					onClick: () => {
						const url = `${overlay.dashboardBase.replace(/\/+$/, "")}/extension/connect/?ext=${encodeURIComponent(chrome.runtime.id)}&device=${encodeURIComponent(guessDeviceName())}`;
						void chrome.tabs.create({ url });
					},
				};
			}
			break;
		case "ebay_signin":
			if (status === "done") title = "Signed in to eBay";
			if (status === "active") {
				cta = { label: "Open ↗", onClick: () => void chrome.tabs.create({ url: "https://www.ebay.com/" }) };
			}
			break;
		case "seller_oauth":
			if (status === "done") title = "Seller account connected";
			if (status === "active") {
				cta = {
					label: "Connect",
					onClick: () =>
						void chrome.tabs.create({
							url: `${overlay.dashboardBase.replace(/\/+$/, "")}/dashboard/?connect=ebay`,
						}),
				};
			}
			break;
	}

	return { id: step.id, status, required: step.required, title, sub: shortSub(step.id, status), cta };
}

/** Short, single-line label for the step row. */
function shortTitle(step: SetupStep): string {
	switch (step.id) {
		case "pair_extension":
			return "Pair this Chrome";
		case "ebay_signin":
			return "Sign in to eBay";
		case "seller_oauth":
			return "Connect seller";
	}
}

/** One concise line under the title — only on active rows. Tells the
 * user *why* this step matters in the resell loop, not how to do it
 * (the CTA / expand area handles the how). Done + locked rows get
 * no sub: title alone carries the state. */
function shortSub(id: SetupStep["id"], status: StepStatus): string {
	if (status !== "active") return "";
	switch (id) {
		case "pair_extension":
			return "Required for buying via the bridge.";
		case "ebay_signin":
			return "We read your existing session — no password.";
		case "seller_oauth":
			return "OAuth on the dashboard. Required to list & sell.";
	}
}

function renderSteps(steps: StepRow[], allRequiredDone: boolean): void {
	const list = $<HTMLUListElement>("step-list");
	const setup = $<HTMLElement>("setup");
	list.innerHTML = "";

	const everythingDone = steps.every((s) => s.status === "done");
	setup.dataset.allDone = String(everythingDone || allRequiredDone);
	if (everythingDone) {
		const li = document.createElement("li");
		li.className = "hp-setup-done";
		const dot = document.createElement("span");
		dot.className = "hp-setup-done-dot";
		const label = document.createElement("span");
		label.textContent = "All set — flipagent is ready.";
		li.append(dot, label);
		list.appendChild(li);
		return;
	}

	for (const step of steps) {
		const li = document.createElement("li");
		li.className = `hp-step is-${step.status}${step.required ? "" : " is-optional"}`;

		const mark = document.createElement("span");
		mark.className = "hp-step-mark";
		mark.textContent = step.status === "done" ? "✓" : step.status === "active" ? "●" : "○";
		li.appendChild(mark);

		const content = document.createElement("div");
		content.className = "hp-step-content";

		const title = document.createElement("div");
		title.className = "hp-step-title";
		title.textContent = step.title;
		if (!step.required && step.status !== "done") {
			const tag = document.createElement("span");
			tag.className = "hp-step-optional";
			tag.textContent = " · optional";
			title.appendChild(tag);
		}
		content.appendChild(title);

		if (step.sub) {
			const sub = document.createElement("div");
			sub.className = "hp-step-sub";
			sub.textContent = step.sub;
			content.appendChild(sub);
		}

		li.appendChild(content);

		if (step.cta) {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = "hp-step-cta";
			btn.textContent = step.cta.label;
			btn.addEventListener("click", step.cta.onClick);
			li.appendChild(btn);
		} else {
			// keep grid alignment
			const spacer = document.createElement("span");
			spacer.setAttribute("aria-hidden", "true");
			li.appendChild(spacer);
		}

		list.appendChild(li);
	}
}

function guessDeviceName(): string {
	const ua = navigator.userAgent;
	if (/Mac/.test(ua)) return "mac";
	if (/Windows/.test(ua)) return "windows";
	if (/Linux/.test(ua)) return "linux";
	return "browser";
}

/* ------------------------------- now panel ------------------------------- */
/* Reads two storage keys: `flipagent_in_flight` (the buy job) and
 * `flipagent_running_evals` (mirror of evaluate-store running set).
 * Renders one row per active job. Empty state nudges the user to click
 * Eval on an eBay listing — that's the on-page surface where most work
 * starts. */

interface InFlightSnapshot {
	id: string;
	marketplace: string;
	itemId?: string;
	maxPriceCents?: number | null;
	status: string;
	startedAt: string;
}

async function renderNow(): Promise<void> {
	const stored = await chrome.storage.local.get([STORAGE_KEYS.IN_FLIGHT_BUY, STORAGE_KEYS.RUNNING_EVALS]);
	const buy = stored[STORAGE_KEYS.IN_FLIGHT_BUY] as InFlightSnapshot | undefined;
	const evalsMap = (stored[STORAGE_KEYS.RUNNING_EVALS] ?? {}) as Record<string, RunningEvalEntry>;

	const now = Date.now();
	const liveEvals = Object.entries(evalsMap).filter(([, v]) => {
		const age = now - new Date(v.startedAt).getTime();
		return Number.isFinite(age) && age < RUNNING_MIRROR_TTL_MS;
	});

	const section = $<HTMLElement>("now");
	const list = $<HTMLUListElement>("now-list");
	list.innerHTML = "";

	if (!buy && liveEvals.length === 0) {
		section.hidden = true;
		return;
	}
	section.hidden = false;

	if (buy) list.appendChild(renderBuyRow(buy));
	for (const [itemId, entry] of liveEvals) {
		list.appendChild(renderEvalRow(itemId, entry));
	}
}

function renderBuyRow(buy: InFlightSnapshot): HTMLLIElement {
	const li = document.createElement("li");
	li.className = "hp-now-row";

	const dot = document.createElement("span");
	dot.className = `hp-now-dot ${buy.status === "completed" ? "ok" : buy.status === "failed" ? "err" : "live"}`;
	li.appendChild(dot);

	const body = document.createElement("div");
	body.className = "hp-now-body";
	const title = document.createElement("div");
	title.className = "hp-now-title";
	title.textContent = `Buy · ${buy.itemId ?? buy.marketplace}`;
	body.appendChild(title);
	const sub = document.createElement("div");
	sub.className = "hp-now-sub";
	const subParts = [buy.status];
	if (buy.maxPriceCents != null) subParts.push(`max $${(buy.maxPriceCents / 100).toFixed(2)}`);
	sub.textContent = subParts.join(" · ");
	body.appendChild(sub);
	li.appendChild(body);

	const cancel = document.createElement("button");
	cancel.type = "button";
	cancel.className = "hp-now-cancel";
	cancel.textContent = "Cancel";
	cancel.title = "Cancel order and close the eBay tab";
	cancel.addEventListener("click", () => {
		void chrome.runtime.sendMessage({ type: MESSAGES.CANCEL_AND_CLOSE }).catch(() => {});
	});
	li.appendChild(cancel);

	return li;
}

function renderEvalRow(itemId: string, entry: RunningEvalEntry): HTMLLIElement {
	const li = document.createElement("li");
	li.className = "hp-now-row";

	const dot = document.createElement("span");
	dot.className = "hp-now-dot live";
	li.appendChild(dot);

	const body = document.createElement("div");
	body.className = "hp-now-body";
	const title = document.createElement("div");
	title.className = "hp-now-title";
	title.textContent = `Eval · ${itemId}`;
	body.appendChild(title);
	const sub = document.createElement("div");
	sub.className = "hp-now-sub";
	sub.textContent = entry.phaseLabel || "running";
	body.appendChild(sub);
	li.appendChild(body);

	return li;
}

/* ------------------------------ refresh tick ----------------------------- */

let cachedCaps: CapabilitiesResponse | null = null;
let capsAt = 0;
const CAPS_TTL_MS = 30_000;

function invalidateCapsCache() {
	cachedCaps = null;
	capsAt = 0;
}

async function getCaps(cfg: ExtensionConfig, force: boolean): Promise<CapabilitiesResponse | null> {
	if (!cfg.apiKey) return null;
	if (!force && cachedCaps && Date.now() - capsAt < CAPS_TTL_MS) return cachedCaps;
	const fresh = await fetchCapabilities(cfg);
	cachedCaps = fresh;
	capsAt = Date.now();
	return fresh;
}

async function refresh(force = false): Promise<void> {
	const cfg = await loadConfig();
	const paired = !!cfg.apiKey && !!cfg.bridgeToken;

	const dash = document.getElementById("dashboard-link") as HTMLAnchorElement | null;
	const foot = document.getElementById("signout-foot") as HTMLElement | null;
	if (dash) dash.hidden = !paired;
	if (foot) foot.hidden = !paired;

	let caps: CapabilitiesResponse | null = null;
	let capsErr: string | null = null;
	if (paired) {
		try {
			caps = await getCaps(cfg, force);
		} catch (err) {
			capsErr = (err as Error).message ?? "Couldn't reach flipagent.";
		}
	}

	// Local-state overlay — chrome.storage holds the canonical "right
	// now" buyer view (extension's own DOM probe). For the unpaired
	// case we synthesise an offline checklist: just the pair step
	// active, the rest locked.
	const buyer = await readBuyerState().catch(() => null);

	const dashboardBase = inferDashboardBase(cfg);
	const overlay = {
		ebayUserName: buyer?.ebayUserName ?? null,
		deviceName: caps?.client.deviceName ?? cfg.deviceName ?? null,
		dashboardBase,
	};

	const serverSteps = caps?.checklist.steps ?? offlineChecklist();
	const allRequiredDone = caps?.checklist.allRequiredDone ?? false;
	const rows = serverSteps.map((s) => adornStep(s, overlay));

	// If the api fetch failed (paired but offline / 5xx), prefix the
	// pair-step title so the user sees why nothing's moving. Cheap,
	// no extra DOM.
	if (capsErr && rows[0]) rows[0].title = `${rows[0].title} · offline`;

	renderSteps(rows, allRequiredDone);
}

function offlineChecklist(): SetupStep[] {
	return [
		{
			id: "pair_extension",
			status: "active",
			required: true,
			title: "Pair this Chrome",
			description: "Sign in via the dashboard to pair this browser.",
			unlocks: ["buy", "bridge", "forwarder"],
		},
		{
			id: "ebay_signin",
			status: "locked",
			required: true,
			title: "Sign in to eBay",
			description: "Available after pairing.",
			unlocks: ["buy"],
		},
		{
			id: "seller_oauth",
			status: "locked",
			required: true,
			title: "Connect seller account",
			description: "Available after pairing.",
			unlocks: ["sell"],
		},
	];
}

function inferDashboardBase(_cfg: ExtensionConfig): string {
	// Baked at build time (build.mjs `define`) — prod bakes
	// https://flipagent.dev, dev bakes whatever FLIPAGENT_DASHBOARD_BASE
	// the build script saw. Self-host operators rebuild with their own.
	return DEFAULT_DASHBOARD_BASE_URL;
}

chrome.storage.onChanged.addListener((changes, area) => {
	if (area !== "local") return;
	if (STORAGE_KEYS.IN_FLIGHT_BUY in changes || STORAGE_KEYS.RUNNING_EVALS in changes) {
		void renderNow();
	}
	if (STORAGE_KEYS.CONFIG in changes) {
		invalidateCapsCache();
		void refresh(true);
	}
	if (STORAGE_KEYS.BUYER_STATE in changes) {
		// Local mirror updated — re-render without refetching capabilities.
		void refresh(false);
	}
});

chrome.runtime.onMessage.addListener((msg) => {
	if (msg?.type === MESSAGES.EVENT) {
		void refresh();
		void renderNow();
	}
	return false;
});

/* ------------------------------- sign out ------------------------------- */

$("signout").addEventListener("click", async () => {
	if (!confirm("Sign out of flipagent on this Chrome? You'll need to sign in again.")) return;
	await clearConfig();
	invalidateCapsCache();
	await refresh();
});

/* -------------------------------- bootstrap -------------------------------- */

async function init(): Promise<void> {
	const dashLink = document.querySelector<HTMLAnchorElement>(".hp-head-link");
	if (dashLink) dashLink.href = dashboardUrl(DASHBOARD_PATHS.DASHBOARD);
	await Promise.all([refresh(), renderNow()]);
}

void init();
