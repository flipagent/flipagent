/**
 * Shared connection chip — pill button + popover with eBay account +
 * browser-extension rows. One source of truth, used by:
 *   - PlaygroundAgent (composer header)
 *   - Dashboard TopBar
 *
 * State (`useConnections()`) lives in `<ConnectionsProvider>` so every
 * mount sees the same status / extension presence / ebay handle. The
 * chip itself is presentational — opening / closing handled internally
 * with an outside-click effect.
 */

import { useEffect, useRef, useState } from "react";
import "./ConnChip.css";
import { useConnections } from "./ConnectionsContext";

/** Best-effort device label for the pair URL. Mirrors the hero chip's
 *  prior local helper so the resulting URL still reads
 *  `…?device=Chrome%20on%20Mac`. */
function guessDeviceName(): string {
	const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
	const browser = /Edg/i.test(ua)
		? "Edge"
		: /Chrome/i.test(ua)
			? "Chrome"
			: /Firefox/i.test(ua)
				? "Firefox"
				: /Safari/i.test(ua)
					? "Safari"
					: "Browser";
	const os = /Mac/i.test(ua) ? "Mac" : /Windows/i.test(ua) ? "Windows" : /Linux/i.test(ua) ? "Linux" : "device";
	return `${browser} on ${os}`;
}

export function ConnChip() {
	const { conn, connLoading, extInstalled, extensionId, ebayConnected, bridgePaired, bridgeOk, openEbayConnect } =
		useConnections();
	const [open, setOpen] = useState(false);
	const wrapRef = useRef<HTMLDivElement | null>(null);

	// Outside-click + Escape to close.
	useEffect(() => {
		if (!open) return;
		function onMouseDown(e: MouseEvent) {
			const wrap = wrapRef.current;
			if (!wrap) return;
			if (wrap.contains(e.target as Node)) return;
			setOpen(false);
		}
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") setOpen(false);
		}
		document.addEventListener("mousedown", onMouseDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onMouseDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const oauthOk = ebayConnected;
	const bridgeInstalled = bridgePaired;
	const anyOk = oauthOk || bridgeOk;
	const loading = connLoading;
	const dotClass = loading ? "conn-chip-dot-loading" : anyOk ? "conn-chip-dot-ok" : "conn-chip-dot-off";
	const label = loading ? "Checking…" : anyOk ? "eBay connected" : "Connect";

	function ebayAction() {
		openEbayConnect();
		setOpen(false);
	}
	function gotoExtension() {
		window.open("/docs/extension/", "_blank", "noopener,noreferrer");
		setOpen(false);
	}

	return (
		<div className="conn-chip-wrap" ref={wrapRef}>
			<button
				type="button"
				className={`conn-chip${anyOk ? " conn-chip-on" : ""}`}
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
				aria-haspopup="menu"
				title={label}
			>
				<span className={`conn-chip-dot ${dotClass}`} />
				<span className="conn-chip-label">{label}</span>
				<svg
					className="conn-chip-chev"
					width="9"
					height="9"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="m6 9 6 6 6-6" />
				</svg>
			</button>
			{open && (
				<div className="conn-chip-pop" role="menu">
					<div className="conn-chip-row">
						<span className={`conn-chip-row-dot ${oauthOk ? "conn-chip-dot-ok" : "conn-chip-dot-off"}`} />
						<div className="conn-chip-row-meta">
							<span className="conn-chip-row-title">eBay account</span>
							<span className="conn-chip-row-sub">
								{oauthOk ? `@${conn?.oauth.ebayUserName ?? "signed in"}` : "Not connected"}
							</span>
						</div>
						<button
							type="button"
							className={`conn-chip-row-action${oauthOk ? " conn-chip-row-action-muted" : ""}`}
							onClick={ebayAction}
						>
							{oauthOk ? "Manage" : "Connect"}
						</button>
					</div>
					<div className="conn-chip-row">
						<span
							className={`conn-chip-row-dot ${
								bridgeOk
									? "conn-chip-dot-ok"
									: bridgeInstalled || extInstalled
										? "conn-chip-dot-warn"
										: "conn-chip-dot-off"
							}`}
						/>
						<div className="conn-chip-row-meta">
							<span className="conn-chip-row-title">Browser extension</span>
							<span className="conn-chip-row-sub">
								{bridgeOk
									? `@${conn?.bridge.ebayUserName ?? "signed in"}`
									: bridgeInstalled
										? "Not signed in to eBay"
										: extInstalled
											? "Not paired"
											: "Not installed"}
							</span>
						</div>
						{bridgeOk ? (
							<button
								type="button"
								className="conn-chip-row-action conn-chip-row-action-muted"
								onClick={() => {
									// Per-device unpair lives on the Devices panel — multiple
									// browsers can pair, so the chip can't pick one to revoke.
									window.dispatchEvent(new CustomEvent("flipagent-goto", { detail: { to: "settings" } }));
									setOpen(false);
								}}
							>
								Manage
							</button>
						) : bridgeInstalled ? (
							<button
								type="button"
								className="conn-chip-row-action"
								onClick={() => {
									window.open("https://www.ebay.com/signin", "_blank", "noopener,noreferrer");
									setOpen(false);
								}}
							>
								Open eBay
							</button>
						) : extInstalled ? (
							<button
								type="button"
								className="conn-chip-row-action"
								onClick={() => {
									if (extensionId) {
										const device = encodeURIComponent(guessDeviceName());
										window.open(
											`/extension/connect/?ext=${encodeURIComponent(extensionId)}&device=${device}`,
											"_blank",
											"noopener,noreferrer",
										);
									} else {
										window.open("/docs/extension/", "_blank", "noopener,noreferrer");
									}
									setOpen(false);
								}}
							>
								Pair
							</button>
						) : (
							<button type="button" className="conn-chip-row-action" onClick={gotoExtension}>
								Install
							</button>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
