/**
 * /extension/connect island. Single-purpose surface: confirm + mint
 * credentials + hand them off to the Chrome extension via
 * `chrome.runtime.sendMessage`.
 *
 * Visual primitives are reused from `Auth.css` (auth-section / auth-rail /
 * auth-cta / auth-brand) so a future redesign of the signup surface
 * picks this page up for free. No new CSS file.
 *
 * URL contract (set by the extension when opening the tab):
 *   ?ext=<extension-id>     — required. Where we send credentials.
 *   ?device=<label>         — optional. Free-text label for the row.
 *
 * Sign-in handoff is delegated to `/signup/`, which already supports
 * `?return=<path>` for post-auth redirects. We send the user there with
 * `return=/extension/connect/?ext=...&device=...` and Auth.tsx returns
 * them here with a session cookie.
 */

import type { MeDeviceConnectResponse, MeProfile } from "@flipagent/types";
import { useEffect, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { apiFetch } from "../../lib/authClient";

type ViewState =
	| { kind: "loading" }
	| { kind: "needs_signin" }
	| { kind: "needs_ext_id" }
	| { kind: "confirm"; user: MeProfile; deviceName: string }
	| { kind: "connecting"; deviceName: string }
	| { kind: "done"; deviceName: string }
	| { kind: "error"; message: string };

export default function ConnectExtension() {
	const [state, setState] = useState<ViewState>({ kind: "loading" });
	// We only attempt the cross-extension `chrome.runtime.sendMessage`
	// once per page load — guard against react-strict-mode double-effects
	// that would otherwise mint two devices on a single click.
	const sentRef = useRef(false);

	useEffect(() => {
		void bootstrap(setState);
	}, []);

	function go(s: ViewState) {
		setState(s);
	}

	async function handleConfirm(deviceName: string) {
		if (sentRef.current) return;
		sentRef.current = true;
		go({ kind: "connecting", deviceName });
		try {
			const credentials = await apiFetch<MeDeviceConnectResponse>("/v1/me/devices", {
				method: "POST",
				body: JSON.stringify({ deviceName }),
			});
			const extId = readQuery("ext");
			if (!extId) {
				go({ kind: "error", message: "Missing extension id in URL." });
				return;
			}
			await sendToExtension(extId, credentials);
			go({ kind: "done", deviceName });
			// Auto-close shortly so the user's focus returns to whatever
			// page they came from (the popup announces success on its end).
			setTimeout(() => window.close(), 1800);
		} catch (err) {
			const msg = (err as Error).message ?? "Something went wrong.";
			toast.error(msg);
			go({ kind: "error", message: msg });
			sentRef.current = false; // allow retry
		}
	}

	return (
		<>
			<Toaster position="top-center" richColors />
			<section className="auth-section auth-section--brand">
				<div className="auth-rail">
					<a href="/" className="auth-brand">
						<img src="/logo.png" width="80" height="24" alt="" aria-hidden="true" />
						<span>flipagent</span>
					</a>
				</div>
			</section>
			<section className="auth-section auth-section--form">
				<div className="auth-rail" style={{ textAlign: "center" }}>
					<Body state={state} onConfirm={handleConfirm} />
				</div>
			</section>
			<section className="auth-section auth-section--foot">
				<div className="auth-rail" style={{ textAlign: "center" }}>
					<p style={{ margin: 0, fontSize: 12, color: "var(--text-3)" }}>
						You can revoke this device anytime from the dashboard.
					</p>
				</div>
			</section>
		</>
	);
}

function Body({ state, onConfirm }: { state: ViewState; onConfirm: (deviceName: string) => void }) {
	if (state.kind === "loading") {
		return <p style={{ color: "var(--text-3)" }}>Checking your session…</p>;
	}
	if (state.kind === "needs_signin") {
		// Auto-redirect; render a fallback for the half-second it takes.
		return <p style={{ color: "var(--text-3)" }}>Redirecting to sign in…</p>;
	}
	if (state.kind === "needs_ext_id") {
		return (
			<>
				<h1 style={{ fontSize: 18, margin: "0 0 8px" }}>Open this from the extension</h1>
				<p style={{ color: "var(--text-3)", fontSize: 13.5, margin: 0 }}>
					This page can only finish the connect flow when launched from the flipagent Chrome extension. Open the extension popup
					and click <strong>Sign in to flipagent</strong>.
				</p>
			</>
		);
	}
	if (state.kind === "confirm") {
		return (
			<>
				<h1 style={{ fontSize: 20, margin: "0 0 6px", letterSpacing: "-0.01em" }}>
					Connect Chrome to flipagent
				</h1>
				<p style={{ color: "var(--text-3)", fontSize: 13.5, margin: "0 0 20px" }}>
					Signed in as <strong style={{ color: "var(--text)" }}>{state.user.email}</strong>. We'll register this Chrome as
					"<strong style={{ color: "var(--text)" }}>{state.deviceName}</strong>" so the extension can run jobs on your behalf.
				</p>
				<button
					type="button"
					className="auth-cta"
					onClick={() => onConfirm(state.deviceName)}
					style={{ minWidth: 200 }}
				>
					Connect this device
				</button>
			</>
		);
	}
	if (state.kind === "connecting") {
		return (
			<p style={{ color: "var(--text-3)" }}>Connecting "{state.deviceName}"…</p>
		);
	}
	if (state.kind === "done") {
		return (
			<>
				<h1 style={{ fontSize: 20, margin: "0 0 6px" }}>Connected ✓</h1>
				<p style={{ color: "var(--text-3)", fontSize: 13.5, margin: 0 }}>
					"{state.deviceName}" is paired. You can close this tab — the extension is ready.
				</p>
			</>
		);
	}
	// error
	return (
		<>
			<h1 style={{ fontSize: 18, margin: "0 0 8px" }}>Couldn't connect</h1>
			<p style={{ color: "var(--text-3)", fontSize: 13.5, margin: "0 0 16px" }}>{state.message}</p>
			<button type="button" className="auth-cta" onClick={() => window.location.reload()}>
				Try again
			</button>
		</>
	);
}

async function bootstrap(setState: (s: ViewState) => void): Promise<void> {
	const extId = readQuery("ext");
	if (!extId) {
		setState({ kind: "needs_ext_id" });
		return;
	}
	const deviceName = readQuery("device") || guessDeviceName();
	try {
		const me = await apiFetch<MeProfile>("/v1/me");
		setState({ kind: "confirm", user: me, deviceName });
	} catch (err) {
		const status = (err as { status?: number }).status;
		if (status === 401) {
			// Not signed in — bounce through /signup which honours ?return=…
			// to land us back here with a session cookie.
			const here = window.location.pathname + window.location.search;
			window.location.replace(`/signup/?return=${encodeURIComponent(here)}`);
			setState({ kind: "needs_signin" });
			return;
		}
		setState({ kind: "error", message: (err as Error).message ?? "Couldn't reach flipagent." });
	}
}

function readQuery(key: string): string | null {
	try {
		return new URLSearchParams(window.location.search).get(key);
	} catch {
		return null;
	}
}

function guessDeviceName(): string {
	const ua = navigator.userAgent;
	if (/Mac/i.test(ua)) return "mac";
	if (/Windows/i.test(ua)) return "windows";
	if (/Linux/i.test(ua)) return "linux";
	if (/CrOS/i.test(ua)) return "chromebook";
	return "browser";
}

/**
 * Cross-context handoff: web page → Chrome extension. Requires the
 * extension's manifest to whitelist this origin under `externally_connectable.matches`.
 *
 * `chrome.runtime.sendMessage` is exposed to web pages only when the
 * target extension declared us as connectable; otherwise the call
 * surfaces `chrome.runtime` as undefined or the message resolves with
 * `lastError = "Could not establish connection. Receiving end does not
 * exist."`. Both surface as a thrown error to the caller.
 */
function sendToExtension(extensionId: string, payload: MeDeviceConnectResponse): Promise<void> {
	return new Promise((resolve, reject) => {
		const cr = (window as unknown as { chrome?: { runtime?: { sendMessage?: typeof chrome.runtime.sendMessage; lastError?: { message: string } } } }).chrome;
		if (!cr?.runtime?.sendMessage) {
			reject(new Error("Chrome extension API unavailable. Is the flipagent extension installed in this Chrome?"));
			return;
		}
		try {
			cr.runtime.sendMessage(
				extensionId,
				{ type: "flipagent:extension-connect", payload },
				(response: unknown) => {
					const err = cr.runtime?.lastError?.message;
					if (err) {
						reject(new Error(err));
						return;
					}
					const ok = (response as { ok?: boolean } | undefined)?.ok;
					if (ok) resolve();
					else reject(new Error("Extension rejected the credentials."));
				},
			);
		} catch (err) {
			reject(err instanceof Error ? err : new Error(String(err)));
		}
	});
}
