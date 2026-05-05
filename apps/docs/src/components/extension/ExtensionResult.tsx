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
	/** Structured payload from typed pipeline errors. `variation_required`
	 * carries `{ legacyId, variations[] }` so we render a SKU picker. */
	details?: unknown;
}

interface EvaluateVariation {
	variationId: string;
	priceCents?: number;
	currency?: string;
	aspects?: ReadonlyArray<{ name?: string; value?: string }>;
}

function readVariationDetails(
	details: unknown,
): { legacyId: string; variations: EvaluateVariation[] } | null {
	if (!details || typeof details !== "object") return null;
	const d = details as { legacyId?: unknown; variations?: unknown };
	if (typeof d.legacyId !== "string" || !Array.isArray(d.variations) || d.variations.length === 0) return null;
	return { legacyId: d.legacyId, variations: d.variations as EvaluateVariation[] };
}

function variationLabel(v: EvaluateVariation): string {
	const parts = (v.aspects ?? [])
		.map((a) => a.value)
		.filter((s): s is string => typeof s === "string" && s.length > 0);
	return parts.length > 0 ? parts.join(" · ") : v.variationId;
}

function formatVariationPrice(v: EvaluateVariation): string | null {
	if (typeof v.priceCents !== "number") return null;
	const dollars = v.priceCents / 100;
	const formatted = dollars.toFixed(dollars % 1 === 0 ? 0 : 2);
	const symbol = v.currency === "USD" || !v.currency ? "$" : `${v.currency} `;
	return `${symbol}${formatted}`;
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

	const variation = state.error?.code === "variation_required" ? readVariationDetails(state.error.details) : null;

	return (
		<>
			{state.error && <ErrorBanner error={state.error} />}
			{variation && <VariationPicker legacyId={variation.legacyId} variations={variation.variations} />}
			<EvaluateResult outcome={state.outcome} steps={state.steps} pending={state.pending} hideHero={false} />
		</>
	);
}

/**
 * SKU picker for `variation_required` failures. The user pasted (or
 * navigated to) a multi-SKU parent listing; eBay default-rendered one
 * variation server-side, which the api refuses to evaluate (it'd score
 * the wrong listing-side price). Each chip opens the canonical
 * `/itm/<legacy>?var=<id>` URL in a new tab — the extension's content
 * script picks that page up and the chip there auto-evaluates the
 * specific SKU.
 */
function VariationPicker({
	legacyId,
	variations,
}: {
	legacyId: string;
	variations: ReadonlyArray<EvaluateVariation>;
}) {
	function urlFor(id: string): string {
		return `https://www.ebay.com/itm/${legacyId}?var=${id}`;
	}
	return (
		<div className="pg-variations" style={{ marginBottom: 12 }}>
			<div className="pg-variations-row">
				{variations.map((v) => {
					const price = formatVariationPrice(v);
					return (
						<a
							key={v.variationId}
							className="pg-variation"
							href={urlFor(v.variationId)}
							target="_blank"
							rel="noreferrer"
						>
							<span className="pg-variation-aspects">{variationLabel(v)}</span>
							{price && <span className="pg-variation-price">{price}</span>}
						</a>
					);
				})}
			</div>
		</div>
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
