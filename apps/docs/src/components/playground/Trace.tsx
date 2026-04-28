/**
 * Collapsible step list for both playground panels. Each step shows its
 * status pill, the API call it executed, and (when expanded) the parsed
 * response. Identical UI for evaluate and discover so users learn it once.
 */

import { useState } from "react";
import type { Step } from "./types";

const STATUS_LABEL: Record<Step["status"], string> = {
	pending: "Waiting",
	running: "Running",
	ok: "Done",
	error: "Failed",
	skipped: "Skipped",
};

export function Trace({ steps }: { steps: Step[] }) {
	return (
		<ol className="pg-trace">
			{steps.map((s, i) => (
				<TraceStep key={s.key} step={s} index={i + 1} />
			))}
		</ol>
	);
}

function TraceStep({ step, index }: { step: Step; index: number }) {
	const [open, setOpen] = useState(false);
	const expandable = step.result !== undefined || step.error !== undefined;
	return (
		<li className={`pg-step pg-step--${step.status}`}>
			<button
				type="button"
				className="pg-step-head"
				onClick={() => expandable && setOpen((o) => !o)}
				aria-expanded={expandable ? open : undefined}
				disabled={!expandable}
			>
				<span className="pg-step-num">{String(index).padStart(2, "0")}</span>
				<span className="pg-step-label">{step.label}</span>
				{step.call && (
					<span className="pg-step-call dash-mono">
						{step.call.method} {step.call.path}
					</span>
				)}
				{step.durationMs != null && step.status !== "running" && (
					<span className="pg-step-duration dash-mono">{step.durationMs}ms</span>
				)}
				<span className={`pg-step-pill pg-step-pill--${step.status}`}>{STATUS_LABEL[step.status]}</span>
			</button>
			{expandable && open && (
				<div className="pg-step-body">
					{step.error && <p className="pg-step-error">{step.error}</p>}
					{step.result !== undefined && (
						<pre className="pg-json">{JSON.stringify(step.result, null, 2)}</pre>
					)}
				</div>
			)}
		</li>
	);
}
