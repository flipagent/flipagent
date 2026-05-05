/**
 * SRP per-card evaluate pill.
 *
 * Architecture, in three rules:
 *
 *   1. **`pills: Map<itemId, Pill>` is the single source of truth.**
 *      One pill per itemId, ever. The reconciler computes the desired
 *      set from cards on the page, then mutates the Map to match.
 *
 *   2. **Mount strategy depends on whether the price sits inside an
 *      `<a>`.** Search / browse cards: price is a sibling of the
 *      `<a>`, so we mount the pill inline inside the price element —
 *      flows next to the dollar amount. Homepage cards: the entire
 *      card is one `<a>`; mounting inside it means clicks bubble out
 *      and trigger navigation. We instead append the host to a
 *      single body-level overlay (outside any `<a>` in the DOM),
 *      then position it absolutely over the price's right edge.
 *
 *   3. **Reconcile runs on rAF-coalesced MutationObserver.** Each
 *      tick: drop pills no longer wanted, create missing ones,
 *      self-heal any orphan hosts. The overlay's pills track the
 *      page's layout via a per-pill ResizeObserver — fires only on
 *      actual size changes (image lazy-load, viewport resize), no
 *      polling.
 */

import { type EvalState, readVisibleState, startEvaluate, subscribe } from "./evaluate-store.js";
import { ICONS, type IconName } from "./icons.js";
import { MESSAGES } from "./messages.js";
import { loadConfig } from "./shared.js";
import { readBuyerState, STORAGE_KEYS } from "./storage.js";
import { connectUrl, ebaySigninUrl } from "./urls.js";

const HOST_CLASS = "flipagent-srp-eval-host";
const HOST_ITEMID_ATTR = "data-flipagent-eval-itemid";
const OVERLAY_ID = "flipagent-srp-overlay";
const PRICE_SELECTOR = ".s-card__price, .s-item__price, .bc-item-detail-price, [itemprop='price']";

interface Pill {
	itemId: string;
	host: HTMLElement;
	wrap: HTMLElement;
	gen: number;
	render: () => void;
	cleanup: () => void;
}

const pills = new Map<string, Pill>();
let observer: MutationObserver | null = null;
let storageListener: ((c: Record<string, chrome.storage.StorageChange>, area: string) => void) | null = null;
let reconcileQueued = false;

export async function mountEvaluateSrp(): Promise<void> {
	queueReconcile();
	observer?.disconnect();
	observer = new MutationObserver(queueReconcile);
	observer.observe(document.body, { childList: true, subtree: true });

	if (!storageListener) {
		storageListener = (changes, area) => {
			if (area !== "local") return;
			if (
				STORAGE_KEYS.BUYER_STATE in changes ||
				STORAGE_KEYS.CONFIG in changes ||
				STORAGE_KEYS.RUNNING_EVALS in changes
			) {
				for (const p of pills.values()) p.render();
			}
		};
		chrome.storage.onChanged.addListener(storageListener);
	}
}

export function unmountEvaluateSrp(): void {
	observer?.disconnect();
	observer = null;
	if (storageListener) {
		chrome.storage.onChanged.removeListener(storageListener);
		storageListener = null;
	}
	for (const p of pills.values()) p.cleanup();
	pills.clear();
	document.getElementById(OVERLAY_ID)?.remove();
}

/* ------------------------------- reconciler ------------------------------- */

function queueReconcile(): void {
	if (reconcileQueued) return;
	reconcileQueued = true;
	requestAnimationFrame(() => {
		reconcileQueued = false;
		reconcile();
	});
}

function reconcile(): void {
	// Build desired Map from every `/itm/{id}` link on the page.
	// First link per itemId wins (eBay duplicates listings across
	// rails — featured + main grid + sponsored).
	const desired = new Map<string, HTMLElement>();
	for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/itm/"]'))) {
		const itemId = extractItemIdFromHref(a.getAttribute("href") ?? "");
		if (!itemId || desired.has(itemId)) continue;
		const card = findCardBoundary(a);
		if (card) desired.set(itemId, card);
	}

	// Drop pills whose itemId is gone OR whose host has been detached
	// (eBay React wiped our injection point).
	for (const [itemId, pill] of pills) {
		if (!desired.has(itemId) || !pill.host.isConnected) {
			pill.cleanup();
			pills.delete(itemId);
		}
	}

	// Create missing pills.
	for (const [itemId, card] of desired) {
		if (pills.has(itemId)) continue;
		const spec = pickMountSpec(card);
		if (spec) createPill(itemId, spec);
	}

	// Self-heal: kill orphan hosts on the page that aren't tracked
	// (stale build, prior content-script instance).
	const tracked = new Set<HTMLElement>();
	for (const p of pills.values()) tracked.add(p.host);
	for (const host of Array.from(document.querySelectorAll<HTMLElement>(`.${HOST_CLASS}`))) {
		if (!tracked.has(host)) host.remove();
	}
}

/* ---------------------------- card discovery ---------------------------- */

function extractItemIdFromHref(href: string): string | null {
	const m = href.match(/\/itm\/(?:[^/?#]+\/)?(\d{6,})(?:\?|#|\/|$)/);
	return m?.[1] ?? null;
}

/** Walk up from an `/itm/` anchor to its card boundary. The card is
 * the smallest ancestor whose siblings are *other cards*. Works
 * uniformly across `<li>`-based search results, `<div>`-based
 * homepage carousels, "recently viewed" rails. */
function findCardBoundary(anchor: HTMLElement): HTMLElement | null {
	let el: HTMLElement | null = anchor;
	while (el?.parentElement && el !== document.body) {
		const parent: HTMLElement = el.parentElement;
		for (const child of Array.from(parent.children) as HTMLElement[]) {
			if (child !== el && child.querySelector('a[href*="/itm/"]')) return el;
		}
		el = parent;
	}
	return anchor.parentElement;
}

type MountSpec = { kind: "inline"; priceEl: HTMLElement } | { kind: "overlay"; priceEl: HTMLElement };

/** Pick mount strategy based on whether the price element sits inside
 * an `<a>` ancestor up to the card root. Inline mount inside the
 * price stays in flow; overlay mounts to a body-level container so
 * clicks never reach the wrapping link's pointerdown navigate. */
function pickMountSpec(card: HTMLElement): MountSpec | null {
	const priceEl = card.querySelector<HTMLElement>(PRICE_SELECTOR);
	if (!priceEl) return null;
	let el: HTMLElement | null = priceEl;
	while (el && el !== card && el !== document.body) {
		if (el instanceof HTMLAnchorElement) return { kind: "overlay", priceEl };
		el = el.parentElement;
	}
	return { kind: "inline", priceEl };
}

/* ------------------------------- pill ------------------------------- */

function createPill(itemId: string, spec: MountSpec): void {
	const host = document.createElement("div");
	host.className = HOST_CLASS;
	host.setAttribute(HOST_ITEMID_ATTR, itemId);
	const shadow = host.attachShadow({ mode: "closed" });
	const style = document.createElement("style");
	style.textContent = ROW_SHADOW_CSS;
	shadow.appendChild(style);
	const wrap = document.createElement("div");
	wrap.className = "fa-row";
	shadow.appendChild(wrap);

	const cleanupLayout = spec.kind === "inline" ? mountInline(host, spec.priceEl) : mountOverlay(host, spec.priceEl);

	const pill: Pill = {
		itemId,
		host,
		wrap,
		gen: 0,
		render: () => {
			void render(pill);
		},
		cleanup: () => {},
	};
	const unsub = subscribe(itemId, pill.render);
	pill.cleanup = () => {
		unsub();
		cleanupLayout();
		host.remove();
	};
	pills.set(itemId, pill);
	pill.render();
}

function mountInline(host: HTMLElement, priceEl: HTMLElement): () => void {
	host.style.cssText = "all:initial;display:inline-block;vertical-align:middle;margin-left:8px;";
	priceEl.appendChild(host);
	return () => {};
}

/** Body-level overlay mount. Host sits OUTSIDE the wrapping `<a>` so
 * clicks can't bubble through it. Position absolute in document
 * coordinates — page scroll moves the pill along automatically (body
 * is the positioning context). A per-pill ResizeObserver re-runs the
 * math when the price element resizes (image lazy-load fills, viewport
 * resize). */
function mountOverlay(host: HTMLElement, priceEl: HTMLElement): () => void {
	host.style.cssText =
		"all:initial;position:absolute;top:0;left:0;z-index:2;pointer-events:auto;will-change:transform;";
	ensureOverlayHost().appendChild(host);

	const updatePosition = () => {
		if (!priceEl.isConnected || !host.isConnected) return;
		// `.bc-item-detail-price` (homepage) is `display: block`
		// stretched to its parent's width, so the element box
		// overshoots the visible "$X.XX" text. A `Range` over the
		// span's contents gives the actual glyph rect.
		const range = document.createRange();
		try {
			range.selectNodeContents(priceEl);
			const r = range.getBoundingClientRect();
			const x = Math.round(r.right + window.scrollX + 6);
			const y = Math.round(r.top + window.scrollY + (r.height - 26) / 2);
			host.style.transform = `translate3d(${x}px, ${y}px, 0)`;
		} finally {
			range.detach?.();
		}
	};
	updatePosition();
	const ro = new ResizeObserver(updatePosition);
	ro.observe(priceEl);
	ro.observe(document.body);
	return () => ro.disconnect();
}

function ensureOverlayHost(): HTMLElement {
	const existing = document.getElementById(OVERLAY_ID);
	if (existing) return existing;
	// Body must be a positioning context so absolute children land in
	// document coordinates (otherwise they fall back to the viewport
	// and stop scrolling with the page). Layout-neutral.
	if (window.getComputedStyle(document.body).position === "static") {
		document.body.style.position = "relative";
	}
	const el = document.createElement("div");
	el.id = OVERLAY_ID;
	el.style.cssText =
		"all:initial;position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483646";
	document.body.appendChild(el);
	return el;
}

/* ------------------------------- render ------------------------------- */

/** Resolve the pill's view from current credentials + buyer-state +
 * eval store, then atomically replace the wrap's contents. Race-safe:
 * each call bumps `pill.gen`; if a later render starts mid-await,
 * the earlier one returns without touching the DOM. */
async function render(pill: Pill): Promise<void> {
	const myGen = ++pill.gen;
	const cfg = await loadConfig();
	if (myGen !== pill.gen) return;
	const buyerState = await readBuyerState().catch(() => null);
	if (myGen !== pill.gen) return;

	let next: HTMLElement;
	if (!cfg.apiKey) {
		next = renderGate("Sign in", "flipagent:srp-setup");
	} else if (!buyerState?.loggedIn) {
		next = renderGate("Sign in to eBay", "flipagent:srp-ebay-signin");
	} else {
		const state = await readVisibleState(pill.itemId);
		if (myGen !== pill.gen) return;
		next = renderRowButton(state, pill.itemId);
	}
	if (myGen !== pill.gen) return;
	pill.wrap.replaceChildren(next);
}

function renderGate(label: string, eventName: string): HTMLElement {
	const root = document.createElement("div");
	root.className = "fa-row-root";
	const btn = makeRowBtn(label, "signin");
	btn.classList.add("fa-row-btn-gate");
	btn.addEventListener("click", (e) => {
		e.stopPropagation();
		e.preventDefault();
		if (eventName === "flipagent:srp-setup") {
			window.open(connectUrl(chrome.runtime.id), "_blank", "noopener,noreferrer");
		} else if (eventName === "flipagent:srp-ebay-signin") {
			window.location.href = ebaySigninUrl(location.href);
		}
	});
	root.appendChild(btn);
	return root;
}

function renderRowButton(state: EvalState, itemId: string): HTMLElement {
	const root = document.createElement("div");
	root.className = "fa-row-root";
	const openSidepanel = () =>
		void chrome.runtime.sendMessage({ type: MESSAGES.OPEN_SIDEPANEL, itemId }).catch(() => {});

	let btn: HTMLButtonElement;
	if (state.kind === "idle") {
		btn = makeRowBtn("Evaluate", "gauge");
		btn.title = "Run Evaluate";
		btn.addEventListener(
			"click",
			clickHandler(() => {
				void startEvaluate(itemId);
				openSidepanel();
			}),
		);
	} else if (state.kind === "running") {
		btn = makeRowBtn("Evaluating…", "spinner");
		btn.title = state.phaseLabel || "Working…";
		btn.addEventListener("click", clickHandler(openSidepanel));
	} else if (state.kind === "error") {
		btn = makeRowBtn("Retry", "refresh");
		btn.title = state.message || "Retry";
		btn.addEventListener("click", clickHandler(openSidepanel));
	} else {
		btn = makeRowBtn("View", "eye");
		btn.title = state.cached ? "View result · cached" : "View result";
		btn.addEventListener("click", clickHandler(openSidepanel));
	}
	root.appendChild(btn);
	return root;
}

function makeRowBtn(label: string, icon: IconName): HTMLButtonElement {
	const spinning = icon === "spinner";
	const btn = document.createElement("button");
	btn.type = "button";
	btn.className = `fa-row-btn${spinning ? " fa-row-btn-busy" : ""}`;
	btn.setAttribute("aria-label", label);
	const mark = document.createElement("span");
	mark.className = spinning ? "fa-row-mark fa-row-mark-spin" : "fa-row-mark";
	if (!spinning) mark.innerHTML = ICONS[icon];
	btn.appendChild(mark);
	btn.appendChild(document.createTextNode(label));
	return btn;
}

function clickHandler(fn: () => void): (e: MouseEvent) => void {
	return (e) => {
		e.stopPropagation();
		e.preventDefault();
		fn();
	};
}

/* ------------------------------- styles ------------------------------- */

const ROW_SHADOW_CSS = `
:host, .fa-row { all: initial; }
.fa-row, .fa-row * {
	box-sizing: border-box;
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
	letter-spacing: -0.005em;
}
.fa-row-root { position: relative; display: inline-block; }
.fa-row-btn {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	height: 26px;
	padding: 0 11px;
	border-radius: 999px;
	border: 1px solid #ff4c00;
	background: #ffffff;
	color: #ff4c00;
	font-size: 11.5px;
	font-weight: 600;
	letter-spacing: -0.005em;
	white-space: nowrap;
	line-height: 1;
	cursor: pointer;
	transition: background 120ms ease, color 120ms ease, border-color 120ms ease, transform 60ms ease;
	box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.fa-row-btn:hover { background: rgba(255, 76, 0, 0.08); color: #e54500; border-color: #e54500; }
.fa-row-btn:active { transform: scale(0.97); }
.fa-row-btn[disabled] { cursor: default; opacity: 0.7; }
.fa-row-btn-busy { cursor: progress; }
@media (prefers-color-scheme: dark) {
	.fa-row-btn { background: #1a1a1a; }
	.fa-row-btn:hover { background: rgba(255, 76, 0, 0.14); }
}
.fa-row-btn-gate {
	border-color: #d4d4d4;
	color: #525252;
	font-weight: 500;
}
.fa-row-btn-gate:hover { border-color: #ff4c00; color: #ff4c00; background: rgba(255, 76, 0, 0.06); }
@media (prefers-color-scheme: dark) {
	.fa-row-btn-gate { color: #b5b5b5; border-color: #2e2e2e; }
}
.fa-row-mark {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 12px;
	height: 12px;
	color: currentColor;
}
.fa-row-mark svg { width: 12px; height: 12px; display: block; }
.fa-row-mark-spin {
	border: 1.6px solid currentColor;
	border-right-color: transparent;
	border-radius: 50%;
	animation: fa-row-spin 0.9s linear infinite;
}
.fa-row-mark-spin svg { display: none; }
@keyframes fa-row-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .fa-row-mark-spin { animation: none; } }
`;
