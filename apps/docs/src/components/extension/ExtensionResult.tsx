/**
 * Side-panel iframe body. Renders the playground's `<EvaluateResult>`
 * with whatever outcome the parent (extension's sidepanel.ts) has
 * posted via `window.postMessage`. Pending / final / error states all
 * flow through the same component the dashboard playground uses, so
 * the visual + interaction model stays 1:1 with the playground.
 *
 * Wire protocol (parent → iframe):
 *   { type: "flipagent:result", outcome, steps, pending, error? }
 *
 * The iframe doesn't fetch or compute anything — outcome is built in
 * the extension's evaluate-store from cache + SSE traces and pushed
 * here. That keeps cross-origin auth out of the picture (no cookies
 * needed) and means we never charge a second credit for data the
 * extension already has.
 *
 * Error rendering: when `error` is set, we render a banner ABOVE the
 * full `<EvaluateResult>` so the user keeps the trace + whatever
 * partial outcome landed before the failure. The store flips
 * still-running steps to error before sending, so the trace visually
 * marks WHERE the pipeline stopped.
 */

import { useEffect, useState } from "react";
import { EvaluateResult } from "../playground/EvaluateResult";
import type { EvaluateOutcome } from "../playground/pipelines";
import type { Step } from "../playground/types";

interface IframeError {
	message: string;
	code: string | null;
	upgradeUrl: string | null;
}

interface IncomingMessage {
	type: "flipagent:result";
	outcome: Partial<EvaluateOutcome>;
	steps: Step[];
	pending: boolean;
	error?: IframeError;
}

interface State {
	outcome: Partial<EvaluateOutcome>;
	steps: Step[];
	pending: boolean;
	error: IframeError | null;
	hasData: boolean;
}

const INITIAL_STATE: State = { outcome: {}, steps: [], pending: false, error: null, hasData: false };

export default function ExtensionResult() {
	const [state, setState] = useState<State>(INITIAL_STATE);

	useEffect(() => {
		function onMessage(e: MessageEvent) {
			const msg = e.data as IncomingMessage | undefined;
			if (!msg || msg.type !== "flipagent:result") return;
			setState({
				outcome: msg.outcome ?? {},
				steps: msg.steps ?? [],
				pending: !!msg.pending,
				error: msg.error ?? null,
				hasData: true,
			});
		}
		window.addEventListener("message", onMessage);
		// Tell the parent we're ready so it posts the initial state
		// even if it sent before this listener mounted.
		try {
			window.parent.postMessage({ type: "flipagent:ready" }, "*");
		} catch {
			/* same-origin parent guard — safe to ignore */
		}
		return () => window.removeEventListener("message", onMessage);
	}, []);

	if (!state.hasData) {
		return (
			<div style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-3)" }}>
				Click <strong>Evaluate</strong> on any eBay listing to see results here.
			</div>
		);
	}

	return (
		<>
			{state.error && <ErrorBanner error={state.error} />}
			<EvaluateResult outcome={state.outcome} steps={state.steps} pending={state.pending} hideHero={false} />
		</>
	);
}

/** Inline error banner — sits above the regular `<EvaluateResult>` so
 * the trace + any partial outcome stay visible underneath. Shape mirrors
 * the playground's error banner pattern (red text + optional Upgrade
 * link). For `credits_exceeded` we surface a richer call-to-action with
 * an Upgrade button — the most common terminal error and the one that
 * needs a one-click fix path. */
function ErrorBanner({ error }: { error: IframeError }) {
	const isCredits = error.code === "credits_exceeded";
	const upgradeUrl = error.upgradeUrl ?? "/pricing/";
	return (
		<div
			style={{
				display: "flex",
				alignItems: "flex-start",
				justifyContent: "space-between",
				gap: 12,
				padding: "10px 12px",
				marginBottom: 12,
				borderRadius: 6,
				background: "rgba(207, 34, 46, 0.08)",
				border: "1px solid rgba(207, 34, 46, 0.25)",
			}}
		>
			<div style={{ minWidth: 0 }}>
				<p
					style={{
						margin: 0,
						fontFamily: "var(--mono)",
						fontSize: 10.5,
						letterSpacing: "0.06em",
						textTransform: "uppercase",
						color: "#cf222e",
						marginBottom: 3,
					}}
				>
					{isCredits ? "Out of credits" : "Evaluate failed"}
				</p>
				<p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: "var(--text)" }}>
					{isCredits
						? "Free tier includes 1,000 credits (~12 evaluations). Upgrade for more."
						: error.message}
				</p>
			</div>
			{isCredits && (
				<a
					href={upgradeUrl}
					target="_blank"
					rel="noreferrer"
					style={{
						flexShrink: 0,
						display: "inline-flex",
						alignItems: "center",
						padding: "6px 12px",
						borderRadius: 999,
						background: "var(--brand)",
						color: "#fff",
						fontSize: 12,
						fontWeight: 600,
						textDecoration: "none",
					}}
				>
					Upgrade
				</a>
			)}
		</div>
	);
}
