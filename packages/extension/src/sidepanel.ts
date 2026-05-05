/**
 * Side panel — thin iframe host that loads the dashboard's
 * `/extension/result/` page and posts the evaluate outcome to it.
 * Reuses the playground's actual `<EvaluateResult>` so the rendering
 * is 1:1 with the dashboard.
 *
 * Data flow:
 *   1. background SW writes `flipagent_sidepanel_itemId` and opens
 *      this panel
 *   2. we read the running mirror + cache for that itemId from
 *      `chrome.storage.local`
 *   3. on every storage onChanged, we re-derive an `EvaluateOutcome`
 *      shape and `postMessage` it to the iframe
 *   4. iframe (apps/docs/.../ExtensionResult.tsx) renders
 *      `<EvaluateResult outcome={...} steps={...} pending={...}>`
 *
 * The iframe runs at the dashboard origin so it has no chrome.* APIs;
 * everything must come over postMessage. Iframe sends back a
 * `{ type: MESSAGES.IFRAME_READY }` once mounted so we resend the latest
 * state in case the iframe loaded after our first post.
 */

import { MESSAGES } from "./messages.js";
import { type PartialOutcomeEntry, RUNNING_MIRROR_TTL_MS, type RunningEvalEntry, STORAGE_KEYS } from "./storage.js";
import { DASHBOARD_PATHS, dashboardUrl } from "./urls.js";

const frame = document.getElementById("sp-frame") as HTMLIFrameElement;
const resultUrl = dashboardUrl(DASHBOARD_PATHS.RESULT);
const iframeOrigin = new URL(resultUrl).origin;

frame.src = resultUrl;

interface IframePayload {
	outcome: Record<string, unknown>;
	steps: unknown[];
	pending: boolean;
	error?: { message: string; code: string | null; upgradeUrl: string | null; details?: unknown };
}

let lastPosted: IframePayload | null = null;
// Until the iframe announces `IFRAME_READY`, its `contentWindow.origin`
// is still the side-panel's chrome-extension origin (navigation to
// `flipagent.dev` hasn't committed yet). Posting before then with a
// `https://flipagent.dev` target origin throws "target origin does not
// match recipient window's origin". We buffer in `lastPosted` and
// flush once the iframe handshakes.
let iframeReady = false;

async function compute(): Promise<IframePayload | null> {
	const stored = await chrome.storage.local.get([
		STORAGE_KEYS.SIDEPANEL_ITEM_ID,
		STORAGE_KEYS.RUNNING_EVALS,
		STORAGE_KEYS.PARTIAL_OUTCOME,
	]);
	const itemId = stored[STORAGE_KEYS.SIDEPANEL_ITEM_ID] as string | undefined;
	if (!itemId) return null;

	const runningMap = (stored[STORAGE_KEYS.RUNNING_EVALS] ?? {}) as Record<string, RunningEvalEntry>;
	const partialMap = (stored[STORAGE_KEYS.PARTIAL_OUTCOME] ?? {}) as Record<string, PartialOutcomeEntry>;

	// Error takes precedence — if the last attempt failed (credits_exceeded,
	// network, etc), surface that to the iframe so the side panel
	// renders an error pane instead of a stuck loading skeleton.
	const partial = partialMap[itemId];
	if (partial?.error) {
		return {
			outcome: partial.outcome,
			steps: partial.steps,
			pending: false,
			error: partial.error,
		};
	}

	// Worker still streaming — render partial outcome with `pending=true`
	// so the playground component shows skeletons + trace as it fills in.
	const running = runningMap[itemId];
	if (running) {
		const age = Date.now() - new Date(running.startedAt).getTime();
		if (Number.isFinite(age) && age < RUNNING_MIRROR_TTL_MS) {
			return {
				outcome: partial?.outcome ?? {},
				steps: partial?.steps ?? [],
				pending: true,
			};
		}
	}

	// Persistent cache lives server-side in `compute_jobs` (cross-surface
	// observation lake doubles as cache). The side panel reaches into it
	// via `GET /v1/evaluate/jobs/{id}` when a row is opened from the
	// dashboard's history list — no extension-local cache mirror.
	return { outcome: partial?.outcome ?? {}, steps: partial?.steps ?? [], pending: false };
}

async function syncToIframe(): Promise<void> {
	const next = await compute();
	if (!next) return;
	lastPosted = next;
	if (iframeReady) post(next);
}

function post(payload: IframePayload): void {
	if (!frame.contentWindow) return;
	frame.contentWindow.postMessage({ type: MESSAGES.IFRAME_RESULT, ...payload }, iframeOrigin);
}

window.addEventListener("message", (e: MessageEvent) => {
	if (e.origin !== iframeOrigin) return;
	const msg = e.data as { type?: string } | undefined;
	if (msg?.type === MESSAGES.IFRAME_READY) {
		iframeReady = true;
		if (lastPosted) post(lastPosted);
	}
});

chrome.storage.onChanged.addListener((changes, area) => {
	if (area !== "local") return;
	if (
		STORAGE_KEYS.SIDEPANEL_ITEM_ID in changes ||
		STORAGE_KEYS.RUNNING_EVALS in changes ||
		STORAGE_KEYS.PARTIAL_OUTCOME in changes
	) {
		void syncToIframe();
	}
});

// Pre-warm `lastPosted` so the moment IFRAME_READY arrives we replay
// the latest state. The iframe's `load` event fires before the inner
// page's listener has wired up, so we can't post here directly — the
// IFRAME_READY handshake is the only safe gate.
void syncToIframe();
