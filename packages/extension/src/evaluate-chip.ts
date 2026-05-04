/**
 * On-page evaluate widget — a small floating chip on `/itm/{id}` pages
 * that the user clicks to run a flipagent evaluation against the item
 * they're already looking at. Same agentic value as MCP-driven evaluate
 * (sold-pool stats, BUY/HOLD/SKIP rating, expected net), surfaced where
 * sourcing decisions actually happen.
 *
 * Per-itemId state (idle / running / done / error) lives in
 * `evaluate-store.ts` so this chip and the per-row SRP buttons share
 * one source of truth — running an evaluate on `/sch/...` and then
 * navigating to that item's `/itm/...` page surfaces the same verdict
 * without re-spending a credit.
 *
 * Style isolation: the chip mounts inside a closed Shadow DOM with all
 * styles inlined. eBay's page CSS does not bleed in; our styles do not
 * leak out. Tokens mirror the popup surface (popup.css) so the chip
 * feels like part of the same product.
 */

import {
	attachActiveIfAny,
	cancelEvaluate,
	type EvalState,
	readVisibleState,
	resetEvaluate,
	startEvaluate,
	subscribe,
} from "./evaluate-store.js";
import { ICONS, type IconName } from "./icons.js";
import { CHIP_EVENTS, type ChipEvent, MESSAGES } from "./messages.js";
import { loadConfig } from "./shared.js";
import { readBuyerState, STORAGE_KEYS } from "./storage.js";
import { connectUrl, ebaySigninUrl } from "./urls.js";

const HOST_ID = "flipagent-evaluate-chip";

type ViewState =
	| { kind: "idle" }
	| { kind: "needs-setup" }
	| { kind: "needs-ebay" }
	| { kind: "running"; stepLabel: string; mirrored: boolean }
	| { kind: "done"; cached: boolean }
	| { kind: "error"; message: string; code: string | null; upgradeUrl: string | null };

interface ChipController {
	host: HTMLElement;
	render: (state: ViewState) => void;
}

let mounted: { ctrl: ChipController; itemId: string; unsubStore: () => void } | null = null;

export async function mountEvaluateChip(itemId: string): Promise<void> {
	if (document.getElementById(HOST_ID)) return; // already mounted on this page

	const ctrl = createChip();

	const unsubStore = subscribe(itemId, () => {
		void renderForCurrentState(itemId, ctrl);
	});

	// Reactively re-render on credential / buyer-state changes (gates)
	// AND on cross-tab evaluate state mirrors. RUNNING_EVALS catches
	// the SRP-tab → /itm-tab handoff mid-run; EVAL_CACHE catches the
	// moment another tab finishes.
	const onStorage = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
		if (area !== "local") return;
		if (
			STORAGE_KEYS.BUYER_STATE in changes ||
			STORAGE_KEYS.CONFIG in changes ||
			STORAGE_KEYS.RUNNING_EVALS in changes ||
			STORAGE_KEYS.EVAL_CACHE in changes
		) {
			void renderForCurrentState(itemId, ctrl);
		}
		// Side panel's "Re-evaluate" routes back to the originating
		// tab via this storage key (background can't mutate the
		// in-process evaluate-store directly). If the request is for
		// our itemId, kick off a fresh evaluate.
		if (STORAGE_KEYS.EVAL_RERUN_REQUEST in changes) {
			const req = changes[STORAGE_KEYS.EVAL_RERUN_REQUEST]?.newValue as { itemId?: string } | undefined;
			if (req?.itemId === itemId) {
				resetEvaluate(itemId);
				void startEvaluate(itemId);
			}
		}
	};
	chrome.storage.onChanged.addListener(onStorage);

	mounted = {
		ctrl,
		itemId,
		unsubStore: () => {
			unsubStore();
			chrome.storage.onChanged.removeListener(onStorage);
		},
	};

	ctrl.host.addEventListener(CHIP_EVENTS.RUN, () => {
		// Kick off the evaluate AND open the side panel so the user
		// sees live progress + partial outcome rendering from the
		// moment they click — mirrors playground UX where Run takes
		// you straight to the live result surface.
		void startEvaluate(itemId);
		void chrome.runtime.sendMessage({ type: MESSAGES.OPEN_SIDEPANEL, itemId }).catch(() => {});
	});
	ctrl.host.addEventListener(CHIP_EVENTS.RERUN, () => {
		resetEvaluate(itemId);
		void startEvaluate(itemId);
	});
	ctrl.host.addEventListener(CHIP_EVENTS.CANCEL, () => {
		cancelEvaluate(itemId);
	});
	ctrl.host.addEventListener(CHIP_EVENTS.VIEW, () => {
		// Route through the background SW so the user-gesture window
		// reaches `chrome.sidePanel.open` (content scripts can't call
		// it directly). BG writes the focus itemId + opens the panel.
		void chrome.runtime.sendMessage({ type: MESSAGES.OPEN_SIDEPANEL, itemId }).catch(() => {});
	});
	ctrl.host.addEventListener(CHIP_EVENTS.DISMISS, () => {
		unmount();
	});
	ctrl.host.addEventListener(CHIP_EVENTS.SETUP, () => {
		window.open(connectUrl(chrome.runtime.id), "_blank", "noopener,noreferrer");
	});
	ctrl.host.addEventListener(CHIP_EVENTS.EBAY_SIGNIN, () => {
		window.location.href = ebaySigninUrl(location.href);
	});

	await renderForCurrentState(itemId, ctrl);

	// Cross-surface live sync — if the dashboard / MCP client already
	// started an evaluate for this itemId, attach to its stream so the
	// chip reflects the live progress instead of showing idle. Fires
	// once per mount; the storage onChanged + store subscription above
	// cover any subsequent state transitions.
	void attachActiveIfAny(itemId);
}

export function unmountEvaluateChip(): void {
	unmount();
}

function unmount(): void {
	mounted?.unsubStore();
	mounted = null;
	document.getElementById(HOST_ID)?.remove();
}

/**
 * Compute the chip's view state from current credentials + buyer
 * session + per-itemId store state, and render it. Single source of
 * truth for "what should the chip show right now".
 */
async function renderForCurrentState(itemId: string, ctrl: ChipController): Promise<void> {
	const cfg = await loadConfig();
	if (!cfg.apiKey) {
		ctrl.render({ kind: "needs-setup" });
		return;
	}
	const buyerState = await readBuyerState().catch(() => null);
	if (!buyerState?.loggedIn) {
		ctrl.render({ kind: "needs-ebay" });
		return;
	}
	const store = await readVisibleState(itemId);
	ctrl.render(viewFromStore(store));
}

function viewFromStore(s: EvalState): ViewState {
	switch (s.kind) {
		case "idle":
			return { kind: "idle" };
		case "running":
			return { kind: "running", stepLabel: s.stepLabel, mirrored: s.mirrored === true };
		case "done":
			return { kind: "done", cached: s.cached };
		case "error":
			return { kind: "error", message: s.message, code: s.code, upgradeUrl: s.upgradeUrl };
	}
}

/* ----------------------------- rendering ----------------------------- */

function createChip(): ChipController {
	const host = document.createElement("div");
	host.id = HOST_ID;
	const root = host.attachShadow({ mode: "closed" });

	const style = document.createElement("style");
	style.textContent = SHADOW_CSS;
	root.appendChild(style);

	const wrap = document.createElement("div");
	wrap.className = "fa-wrap";
	root.appendChild(wrap);

	// Place the chip in the page's buy-decision context — directly
	// above Buy It Now (or whatever primary CTA the page surfaces) so
	// the verdict is the first thing the user reads on the way to
	// clicking BIN. Falls back to a fixed bottom-right pill when the
	// buybox can't be found (atypical layouts, A/B variants).
	const buyboxAnchor = findBuyboxAnchor();
	if (buyboxAnchor) {
		host.style.cssText = "all:initial;display:block;margin:0 0 12px;";
		wrap.dataset.mode = "inline";
		// Read BIN's computed dimensions and forward as CSS variables
		// so the chip mirrors the live BIN exactly (eBay ships several
		// `.fake-btn--large` variants with different paddings + font
		// sizes; matching at runtime auto-adapts to whichever the page
		// rendered). Falls back to sensible defaults if BIN hasn't
		// laid out yet.
		const rect = buyboxAnchor.getBoundingClientRect();
		const cs = window.getComputedStyle(buyboxAnchor);
		if (rect.height > 0) host.style.setProperty("--fa-bin-height", `${Math.round(rect.height)}px`);
		if (cs.fontSize) host.style.setProperty("--fa-bin-font", cs.fontSize);
		if (cs.borderRadius) host.style.setProperty("--fa-bin-radius", cs.borderRadius);
		// `insertBefore(host, anchor)` puts us in the same parent
		// IMMEDIATELY BEFORE the anchor — visually above it in the
		// vertical action stack.
		buyboxAnchor.parentElement?.insertBefore(host, buyboxAnchor);
	} else {
		host.style.cssText = "all:initial;position:fixed;bottom:18px;right:18px;z-index:2147483647;";
		wrap.dataset.mode = "floating";
		document.body.appendChild(host);
	}

	return {
		host,
		render: (state) => renderState(wrap, state),
	};
}

/**
 * Find an in-page anchor inside eBay's buy-box so we can place the
 * chip next to the BIN / Add to cart actions. Selectors are ordered
 * by stability — `data-testid` is the most durable surface eBay
 * exposes; class-based fallbacks cover legacy / experiment variants.
 *
 * Returns the element after which the chip should be inserted.
 * `null` triggers the floating-pill fallback in `createChip`.
 */
function findBuyboxAnchor(): HTMLElement | null {
	// Order matters — eBay reuses `data-testid="ux-call-to-action"` and
	// `.fake-btn--primary` for non-buy CTAs (e.g. "Sell one like this"),
	// so a generic match grabs the wrong target. BIN-specific signatures
	// come first: the BIN id ("binBtn_btn_1") and BIN's href pattern
	// (`/bin/ctb`) are unique to the actual Buy It Now action.
	const candidates = [
		'a[id^="binBtn_btn"]',
		'a[href*="/bin/ctb"]',
		'[data-testid="x-bin-action"]',
		'[data-testid="d-binbtn"]',
		"#x-bin-action",
		'a[id^="atcBtn_btn"]',
		'[data-testid="x-atc-action"]',
		'[data-testid="d-atcbtn"]',
		"#x-atc-action",
		// Last-resort: the generic ux-call-to-action, but ONLY inside a
		// known buybox container so we never grab a sell-side CTA.
		'#x-buybox [data-testid="ux-call-to-action"]',
		'[data-testid="x-buybox"] [data-testid="ux-call-to-action"]',
		".x-buybox-actions",
		".x-buybox-section",
	];
	for (const sel of candidates) {
		const el = document.querySelector<HTMLElement>(sel);
		if (el) return el;
	}
	return null;
}

/**
 * Render a single button matching the BIN primary-action shape across
 * every state — never expands into a 320px panel. Loading lives INSIDE
 * the button (spinner replaces the sparkle); the verdict / facts live
 * in the right-edge side panel that opens on the "View evaluation"
 * click. Mirrors the user's intent: the chip is the action, the panel
 * is the surface.
 */
function renderState(wrap: HTMLElement, state: ViewState): void {
	wrap.innerHTML = "";
	wrap.appendChild(renderChip(state));
}

function renderChip(state: ViewState): HTMLElement {
	const cfg = chipConfigFor(state);
	const btn = el("button", `fa-chip${cfg.busy ? " fa-chip-busy" : ""}`, {
		type: "button",
		"aria-label": cfg.aria,
	});
	btn.appendChild(makeChipMark(cfg.icon));
	btn.appendChild(el("span", "fa-chip-name", {}, "flipagent"));
	btn.appendChild(el("span", "fa-chip-sep", {}, "·"));
	btn.appendChild(el("span", "fa-chip-cta", {}, cfg.label));
	if (cfg.disabled) {
		btn.disabled = true;
		btn.title = cfg.title ?? "";
	} else {
		btn.addEventListener("click", () => emit(cfg.event));
		if (cfg.title) btn.title = cfg.title;
	}
	return wrapWithDismiss(btn);
}

interface ChipConfig {
	label: string;
	aria: string;
	icon: IconName;
	event: ChipEvent;
	busy?: boolean;
	disabled?: boolean;
	title?: string;
}

function chipConfigFor(state: ViewState): ChipConfig {
	switch (state.kind) {
		case "needs-setup":
			return {
				label: "Sign in to evaluate →",
				aria: "Sign in to flipagent",
				icon: "signin",
				event: CHIP_EVENTS.SETUP,
			};
		case "needs-ebay":
			return {
				label: "Sign in to eBay to evaluate",
				aria: "Sign in to eBay",
				icon: "signin",
				event: CHIP_EVENTS.EBAY_SIGNIN,
			};
		case "running":
			// Click opens the side panel (which streams partial outcome
			// in real time, mirrors playground behaviour). Cancel is no
			// longer wired to the chip — the side panel hosts that.
			return {
				label: "Evaluating…",
				aria: state.mirrored ? "Evaluation running in another tab" : "View live progress",
				icon: "spinner",
				event: CHIP_EVENTS.VIEW,
				busy: true,
				title: state.stepLabel || "Working…",
			};
		case "done":
			return {
				label: "View evaluation",
				aria: "Open evaluation in side panel",
				icon: "eye",
				event: CHIP_EVENTS.VIEW,
			};
		case "error":
			// Click opens the side panel — the panel renders the upgrade
			// prompt (credits_exceeded) or the retry hint for any other
			// failure. Keeping the chip's surface neutral avoids the
			// brand-orange BIN slot turning into a billing CTA.
			return {
				label: "View error",
				aria: "Open error in side panel",
				icon: "refresh",
				event: CHIP_EVENTS.VIEW,
				title: state.message,
			};
		default:
			return {
				label: "Evaluate this item",
				aria: "Evaluate this item with flipagent",
				icon: "gauge",
				event: CHIP_EVENTS.RUN,
			};
	}
}

function makeChipMark(icon: IconName): HTMLSpanElement {
	if (icon === "spinner") return el("span", "fa-chip-mark fa-chip-mark-spin");
	const span = el("span", "fa-chip-mark");
	span.innerHTML = ICONS[icon];
	return span;
}

function wrapWithDismiss(chipEl: HTMLElement): HTMLElement {
	const wrap = el("div", "fa-chip-wrap");
	wrap.appendChild(chipEl);
	const close = el("button", "fa-chip-close", { type: "button", "aria-label": "Dismiss" }, "×");
	close.addEventListener("click", (e) => {
		e.stopPropagation();
		emit(CHIP_EVENTS.DISMISS);
	});
	wrap.appendChild(close);
	return wrap;
}

function emit(type: ChipEvent): void {
	mounted?.ctrl.host.dispatchEvent(new CustomEvent(type, { bubbles: false }));
}

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className: string,
	attrs: Record<string, string> = {},
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	node.className = className;
	for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
	if (text != null) node.textContent = text;
	return node;
}

/* ------------------------------- styles ------------------------------- */
/* Mirrors popup.css tokens — sharp corners, brand orange used sparingly,
 * mono uppercase eyebrows. Inlined into the shadow root so eBay's CSS
 * never bleeds in and our styles never bleed out. */

const SHADOW_CSS = `
:host, .fa-wrap { all: initial; }
.fa-wrap, .fa-wrap * {
	box-sizing: border-box;
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
	letter-spacing: -0.005em;
}
.fa-wrap {
	color: #0a0a0a;
	font-size: 13px;
	line-height: 1.5;
}
@media (prefers-color-scheme: dark) {
	.fa-wrap { color: #f5f5f5; }
}

/* ─── inline mode (placed above Buy It Now) ─── */
/* When the chip lives inside the buybox, it reads as a primary
 * action parallel to eBay's BIN (the .fake-btn--large primary action —
 * 48px tall, 16px text, full-width pill). Brand-orange fill + white
 * text + sparkle icon. The hover-dismiss × is suppressed here —
 * there's no stale state to clear on a buybox-anchored chip; closing
 * would just take the user back to where they started. */
.fa-wrap[data-mode="inline"] .fa-chip-wrap { display: flex; width: 100%; }
.fa-wrap[data-mode="inline"] .fa-chip-close { display: none !important; }
.fa-wrap[data-mode="inline"] .fa-chip {
	flex: 1;
	width: 100%;
	/* Pull dimensions from the live BIN button via CSS vars set on the
	 * host (see createChip → getBoundingClientRect / getComputedStyle).
	 * Defaults match eBay's .fake-btn--large baseline if vars miss. */
	height: var(--fa-bin-height, 52px);
	padding: 0 24px;
	gap: 10px;
	justify-content: center;
	font-size: var(--fa-bin-font, 16px);
	font-weight: 600;
	line-height: 1.2;
	border-radius: var(--fa-bin-radius, 999px);
	background: #ff4c00;
	color: #ffffff;
	border-color: transparent;
	box-shadow: 0 1px 2px rgba(255, 76, 0, 0.18);
}
.fa-wrap[data-mode="inline"] .fa-chip:hover {
	background: #e54500;
	border-color: transparent;
	filter: none;
}
.fa-wrap[data-mode="inline"] .fa-chip-cta { color: inherit; font-weight: 600; letter-spacing: -0.005em; }
.fa-wrap[data-mode="inline"] .fa-chip-mark {
	color: inherit;
	width: 16px;
	height: 16px;
	display: inline-flex;
	align-items: center;
	justify-content: center;
}
.fa-wrap[data-mode="inline"] .fa-chip-mark svg { width: 16px; height: 16px; display: block; }
.fa-wrap[data-mode="inline"] .fa-chip-mark-spin { width: 16px; height: 16px; }
.fa-wrap[data-mode="inline"] .fa-chip-name { display: none; }
.fa-wrap[data-mode="inline"] .fa-chip-sep { display: none; }

/* ─── chip (idle / setup) ─── */
.fa-chip-wrap {
	position: relative;
	display: inline-flex;
	align-items: stretch;
}
.fa-chip {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	padding: 9px 14px 9px 12px;
	height: 34px;
	background: #ffffff;
	color: #0a0a0a;
	border: 1px solid #d4d4d4;
	border-radius: 4px;
	box-shadow: 0 6px 20px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04);
	font-size: 12.5px;
	font-weight: 500;
	cursor: pointer;
	transition: border-color 120ms ease, box-shadow 120ms ease, transform 60ms ease;
}
@media (prefers-color-scheme: dark) {
	.fa-chip {
		background: #141414;
		color: #f5f5f5;
		border-color: #2e2e2e;
		box-shadow: 0 6px 20px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.4);
	}
}
.fa-chip:hover { border-color: #ff4c00; }
.fa-chip:active { transform: scale(0.99); }
.fa-chip-mark {
	color: #ff4c00;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 14px;
	height: 14px;
}
.fa-chip-mark svg { width: 14px; height: 14px; display: block; }
.fa-chip-name { font-weight: 600; }
.fa-chip-sep { color: #a3a3a3; }
.fa-chip-cta { color: #525252; }
@media (prefers-color-scheme: dark) {
	.fa-chip-sep { color: #6a6a6a; }
	.fa-chip-cta { color: #b5b5b5; }
}
.fa-chip-close {
	position: absolute;
	top: -7px;
	right: -7px;
	width: 18px;
	height: 18px;
	border-radius: 50%;
	border: 1px solid #d4d4d4;
	background: #ffffff;
	color: #737373;
	font-size: 13px;
	line-height: 14px;
	cursor: pointer;
	padding: 0;
	display: none;
	align-items: center;
	justify-content: center;
}
@media (prefers-color-scheme: dark) {
	.fa-chip-close { background: #141414; border-color: #2e2e2e; color: #888; }
}
.fa-chip-wrap:hover .fa-chip-close { display: inline-flex; }

/* ─── busy / spinner state (running) ─── */
/* The chip stays the same shape across all states; loading happens
 * INSIDE the button (spinner replaces the sparkle). The 320px panel
 * is gone — the verdict + facts live in the side panel that opens on
 * the "View evaluation" click. */
.fa-chip-busy { cursor: progress; }
.fa-chip-busy:hover { border-color: inherit; }
.fa-chip[disabled] { cursor: default; opacity: 0.85; }

.fa-chip-mark-spin {
	border: 1.6px solid currentColor;
	border-right-color: transparent;
	border-radius: 50%;
	animation: fa-chip-spin 0.9s linear infinite;
}
.fa-chip-mark-spin svg { display: none; }
@keyframes fa-chip-spin {
	to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
	.fa-chip-mark-spin { animation: none; }
}
`;
