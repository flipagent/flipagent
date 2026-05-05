/**
 * Presence beacon — content script injected only on `*.flipagent.dev`
 * (covers prod + the dev tunnel host). Lets the dashboard answer "is
 * the extension installed?" without needing the extension's Chrome ID.
 *
 * Protocol (window.postMessage between content script and page):
 *   ext → page : { type: "flipagent-extension-present", version, paired }
 *                  posted once on load and again whenever the page asks.
 *   page → ext : { type: "flipagent-extension-ping" }
 *                  sent by the dashboard on mount (covers the case where
 *                  the extension's initial post fired before the
 *                  dashboard listener was attached).
 *
 * `paired` reflects only whether the extension currently holds a bridge
 * token in chrome.storage.local — not whether the user is signed into
 * eBay (`bridge.ebayLoggedIn` from /v1/me/ebay/status answers that).
 *
 * No other handlers run here — this file is intentionally tiny so
 * injecting it on every flipagent.dev page is cheap.
 */

type StoredFlipagent = { bridgeToken?: string };

async function readPaired(): Promise<boolean> {
	try {
		const stored = (await chrome.storage.local.get(["flipagent"])) as { flipagent?: StoredFlipagent };
		return !!stored.flipagent?.bridgeToken;
	} catch {
		return false;
	}
}

async function announce(): Promise<void> {
	const paired = await readPaired();
	const version = chrome.runtime.getManifest().version;
	// `extensionId` lets the dashboard build the pair URL
	// (`/extension/connect/?ext=<id>`) without having to hardcode the
	// Chrome Web Store ID — same trick the popup uses when it launches
	// the connect flow itself.
	const extensionId = chrome.runtime.id;
	window.postMessage(
		{ type: "flipagent-extension-present", version, paired, extensionId, source: "flipagent-extension" },
		window.location.origin,
	);
}

void announce();

window.addEventListener("message", (e) => {
	if (e.source !== window) return;
	const data = e.data as { type?: unknown } | null;
	if (!data || data.type !== "flipagent-extension-ping") return;
	void announce();
});
