/**
 * Typed registry of `chrome.runtime.sendMessage` types used inside the
 * extension. One source of truth so background, content scripts,
 * popup, side panel, and the on-page dashboard iframe all agree on
 * the wire format.
 *
 * `MESSAGES` lists strictly the message-type strings; the body
 * shapes live alongside their consumers (e.g. order-progress carries
 * a `BridgeResultRequest`, open-sidepanel carries `{ itemId }`).
 * Centralizing the names alone is enough to catch the common bug of
 * one consumer typing "flipagent:open-side-panel" while the other
 * sent "flipagent:open-sidepanel".
 */

export const MESSAGES = {
	/* ── extension-internal (chrome.runtime.onMessage) ── */
	/** Dispatched by background to popup / content for activity-feed UI. */
	EVENT: "flipagent:event",
	/** Manual poll trigger from popup → background. */
	POLL_NOW: "flipagent:poll-now",
	/** Buyer-state report from content script DOM probe → background. */
	BUYER_STATE: "flipagent:buyer-state",
	/** Planet Express login state from content script URL probe → background. */
	PE_STATE: "flipagent:pe-state",
	/** Order progress (placing / completed / failed) from content → background. */
	ORDER_PROGRESS: "flipagent:order-progress",
	/** Cancel an in-flight buy and close the marketplace tab. */
	CANCEL_AND_CLOSE: "flipagent:cancel-and-close",
	/** Content / chip / SRP click → background opens the side panel. */
	OPEN_SIDEPANEL: "flipagent:open-sidepanel",
	/** Side panel "Re-evaluate" → background → storage → content scripts. */
	RERUN_EVAL: "flipagent:rerun-eval",
	/** Generic synchronous DOM op forwarded from background to a tab's content script. */
	BROWSER_OP: "flipagent:browser-op",
	/** Background asks content script to extract structured data from an eBay page. */
	EBAY_EXTRACT: "flipagent:ebay-extract",

	/* ── externally_connectable (web → extension) ── */
	/** OAuth handoff: dashboard `/extension/connect` → background, carrying credentials. */
	EXTENSION_CONNECT: "flipagent:extension-connect",

	/* ── side-panel iframe postMessage (parent ⇄ iframe) ── */
	/** Sidepanel → iframe: full evaluate payload (outcome + steps + pending + error). */
	IFRAME_RESULT: "flipagent:result",
	/** Iframe → sidepanel: ready-to-receive handshake on mount. */
	IFRAME_READY: "flipagent:ready",
} as const;

/* ── chip / SRP DOM CustomEvent names (Shadow DOM) ── */
/* The chip dispatches these as DOM CustomEvents on its shadow host —
 * not chrome.runtime messages. Distinct namespace (`evaluate-*`) keeps
 * them separate from runtime messages while staying recognisable. */
export const CHIP_EVENTS = {
	RUN: "flipagent:evaluate-run",
	CANCEL: "flipagent:evaluate-cancel",
	VIEW: "flipagent:evaluate-view",
	RERUN: "flipagent:evaluate-rerun",
	DISMISS: "flipagent:evaluate-dismiss",
	SETUP: "flipagent:evaluate-setup",
	EBAY_SIGNIN: "flipagent:evaluate-ebay-signin",
} as const;

export type ChipEvent = (typeof CHIP_EVENTS)[keyof typeof CHIP_EVENTS];
