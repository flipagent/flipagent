/**
 * Connections context — single source of truth for "is the agent able
 * to act?" status across the dashboard. Wraps the api status fetch +
 * extension presence detection + the eBay-connect consent modal so any
 * descendant can:
 *
 *   - read connection status (`conn`, `extInstalled`, …) without
 *     duplicating fetch / window-message wiring.
 *   - trigger Connect / Disconnect from anywhere with one call
 *     (`openEbayConnect()`, `disconnectEbay()`) — the consent modal
 *     mounts here so settings, agent chip, and any future surface all
 *     share the same flow.
 *
 * Drops the old `flipagent-goto` event for the connect path: deep-link
 * `?connect=ebay` is handled here directly by calling `openEbayConnect()`
 * on mount, which keeps the user where they are instead of bouncing them
 * to Settings.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "../../lib/authClient";
import { EbayConnectModal } from "./EbayConnectModal";
import "./Connections.css";

export interface ConnStatus {
	oauth: { connected: boolean; ebayUserName: string | null };
	bridge: { paired: boolean; ebayLoggedIn: boolean; ebayUserName: string | null };
}

interface ConnectionsContextValue {
	conn: ConnStatus | null;
	/** True until the first `/v1/me/ebay/status` round-trip completes
	 *  (success OR failure). After that flips to false and stays there
	 *  so a transient API error doesn't leave the chip stuck on
	 *  "Checking…". */
	connLoading: boolean;
	/** Whether the extension's content script has posted a presence
	 *  beacon. Defaults to false — content scripts run at
	 *  `document_start` so the beacon almost always arrives before
	 *  React mounts and we never see the false → true flip. */
	extInstalled: boolean;
	/** Extension's chrome runtime id, harvested from the presence beacon
	 *  so we can build a working `/extension/connect/?ext=…` URL. */
	extensionId: string | null;
	ebayConnected: boolean;
	bridgePaired: boolean;
	bridgeOk: boolean;
	openEbayConnect: () => void;
	disconnectEbay: () => Promise<void>;
	refresh: () => Promise<void>;
}

// No FALLBACK on purpose. A silent default would let a component
// silently render with stale "extension not installed" / "not connected"
// state when its parent forgot to wrap in `<ConnectionsProvider>` —
// which is exactly the bug we kept hitting on the dashboard. Throwing
// surfaces the missing provider loud-and-fast at first hydration.
const Ctx = createContext<ConnectionsContextValue | null>(null);

export function useConnections(): ConnectionsContextValue {
	const value = useContext(Ctx);
	if (!value) {
		throw new Error("useConnections() must be called inside a <ConnectionsProvider>.");
	}
	return value;
}

/**
 * Static, no-network "connected" snapshot the landing-hero injects when
 * the visitor is logged out. Surfaces (the agent chip) read it as if the
 * user had a real eBay+extension setup so the demo doesn't show
 * "Checking…" / "Connect" CTAs to a marketing visitor. Real fetches stay
 * disabled — the page never makes a /v1/me/ebay/status call from this
 * mount.
 */
const MOCK_VALUE: ConnectionsContextValue = {
	conn: {
		// Plausible reseller-style handle for the popover detail rows —
		// the closed chip reads "eBay connected" generically so this
		// only shows when the visitor opens the popover. Picked to feel
		// like a real account, not a stub.
		oauth: { connected: true, ebayUserName: "resellerpro" },
		bridge: { paired: true, ebayLoggedIn: true, ebayUserName: "resellerpro" },
	},
	connLoading: false,
	extInstalled: true,
	extensionId: "demo",
	ebayConnected: true,
	bridgePaired: true,
	bridgeOk: true,
	openEbayConnect: () => {},
	disconnectEbay: async () => {},
	refresh: async () => {},
};

export function ConnectionsProvider({ children, mock }: { children: ReactNode; mock?: boolean }) {
	// Mock branch returns a static "connected" snapshot — no fetches, no
	// modals. Live branch is its own component so hooks always run in the
	// same order regardless of which branch the parent picks (rules of
	// hooks). The `mock` choice is parent-render-time and shouldn't flip
	// during a mount; it's still cleaner to have the inner component own
	// the hooks unconditionally.
	if (mock) {
		return <Ctx.Provider value={MOCK_VALUE}>{children}</Ctx.Provider>;
	}
	return <LiveConnectionsProvider>{children}</LiveConnectionsProvider>;
}

function LiveConnectionsProvider({ children }: { children: ReactNode }) {
	const [conn, setConn] = useState<ConnStatus | null>(null);
	// True only until the first refresh round-trip resolves (success or
	// fail). After that the chip stops showing "Checking…" — a transient
	// API blip shouldn't strand the UI in a loading state.
	const [connLoading, setConnLoading] = useState(true);
	// Defaults to `false` — "extension not detected (yet)". The content
	// script posts a presence beacon as soon as it loads (at
	// `document_start`, before our React mount in practice), and our
	// listener flips this to `true` the moment one arrives. No timer
	// needed, no separate loading state to communicate to the user —
	// chip starts at "Not installed" and upgrades in-place when a
	// beacon shows up.
	const [extInstalled, setExtInstalled] = useState(false);
	const [extensionId, setExtensionId] = useState<string | null>(null);
	const [ebayModalOpen, setEbayModalOpen] = useState(false);

	const refresh = useCallback(async () => {
		try {
			const next = await apiFetch<ConnStatus>("/v1/me/ebay/status");
			setConn(next);
			// Notify the legacy Dashboard `ebay` state holder so its prop
			// chain (TopBar, Sidebar, SettingsPanel.BridgeRow, …) refreshes
			// after a connect/disconnect flow that ran through the hook.
			window.dispatchEvent(new CustomEvent("flipagent-conn-changed"));
		} catch {
			// Leave previous snapshot — chip degrades to "Connect" CTA.
		} finally {
			setConnLoading(false);
		}
	}, []);

	// Initial fetch + refresh on focus (covers the case where another tab
	// connected/disconnected while this one was idle).
	useEffect(() => {
		void refresh();
		function onFocus() {
			void refresh();
		}
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [refresh]);

	// Extension presence detection. The content script posts
	// `flipagent-extension-present` on every page load and also in reply
	// to our `flipagent-extension-ping`. We listen for the lifetime of
	// the provider — early beacons (script ran before React mount) and
	// late beacons (script loads after our ping) both flip us to `true`
	// the same way. No timer, no null/loading state.
	useEffect(() => {
		function onMessage(e: MessageEvent) {
			if (e.source !== window) return;
			const data = e.data as { type?: unknown; source?: unknown; extensionId?: unknown } | null;
			if (!data || data.type !== "flipagent-extension-present") return;
			if (data.source !== "flipagent-extension") return;
			setExtInstalled(true);
			if (typeof data.extensionId === "string" && data.extensionId.length > 0) {
				setExtensionId(data.extensionId);
			}
		}
		window.addEventListener("message", onMessage);
		window.postMessage({ type: "flipagent-extension-ping" }, window.location.origin);
		return () => window.removeEventListener("message", onMessage);
	}, []);

	// `?connect=ebay` deep-link from the extension popup → open the
	// consent modal in place (no Settings navigation, no sessionStorage).
	useEffect(() => {
		const p = new URLSearchParams(window.location.search);
		if (p.get("connect") === "ebay") {
			setEbayModalOpen(true);
			window.history.replaceState({}, "", window.location.pathname);
		}
	}, []);

	const openEbayConnect = useCallback(() => setEbayModalOpen(true), []);
	const disconnectEbay = useCallback(async () => {
		await apiFetch("/v1/me/ebay/connect", { method: "DELETE" });
		await refresh();
	}, [refresh]);

	const ebayConnected = !!conn?.oauth.connected;
	const bridgePaired = !!conn?.bridge.paired;
	const bridgeOk = bridgePaired && !!conn?.bridge.ebayLoggedIn;

	const value: ConnectionsContextValue = {
		conn,
		connLoading,
		extInstalled,
		extensionId,
		ebayConnected,
		bridgePaired,
		bridgeOk,
		openEbayConnect,
		disconnectEbay,
		refresh,
	};

	return (
		<Ctx.Provider value={value}>
			{children}
			<EbayConnectModal
				open={ebayModalOpen}
				onClose={() => setEbayModalOpen(false)}
				connected={ebayConnected}
				ebayUserName={conn?.oauth.ebayUserName ?? null}
				onDisconnect={async () => {
					await disconnectEbay();
					setEbayModalOpen(false);
				}}
			/>
		</Ctx.Provider>
	);
}
