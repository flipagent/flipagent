/**
 * Collapsible step list for both playground panels. Each step shows its
 * status pill, the API call it executed, and (when expanded) the parsed
 * response. Identical UI for evaluate and discover so users learn it once.
 */

import { useEffect, useState } from "react";
import { apiBase } from "../../lib/authClient";
import type { Step } from "./types";

const STATUS_LABEL: Record<Step["status"], string> = {
	pending: "Waiting",
	running: "Running",
	ok: "Done",
	error: "Failed",
	skipped: "Skipped",
};

export function Trace({ steps }: { steps: Step[] }) {
	// Top-level steps get numbered slots; their children stack vertically
	// under each parent (with a `└` prefix) so each parallel call has full
	// row width for its URL, status, and duration. The parent itself becomes
	// a header row with the bundle status (ok if any child ok, error if all
	// failed).
	const topLevel = steps.filter((s) => !s.parent);
	const childrenByParent = new Map<string, Step[]>();
	for (const s of steps) {
		if (!s.parent) continue;
		const arr = childrenByParent.get(s.parent) ?? [];
		arr.push(s);
		childrenByParent.set(s.parent, arr);
	}
	return (
		<ol className="pg-trace">
			{topLevel.map((s, i) => (
				<TraceStep
					key={s.key}
					step={s}
					index={i + 1}
					children={childrenByParent.get(s.key) ?? []}
				/>
			))}
		</ol>
	);
}

function TraceStep({ step, index, children }: { step: Step; index: number; children: Step[] }) {
	const [open, setOpen] = useState(false);
	const hasChildren = children.length > 0;
	// A row is expandable when it actually has something to show: a
	// `call` (running / ok / error all set this on `started`), a parsed
	// `result`, an `error`, or children to drill into. Pending rows have
	// none of those — keeping them non-expandable avoids the meaningless
	// "Queued." placeholder + a clickable affordance that does nothing.
	const expandable = step.call !== undefined || step.result !== undefined || step.error !== undefined || hasChildren;
	const liveMs = useLiveDuration(step.status);
	const displayMs = step.status === "running" ? liveMs : step.durationMs;
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
				{/* Always render the call slot — even empty — so grid auto-
				    placement keeps the URL column anchored at col 3 (the 1fr
				    flex column). Without this, hero-demo steps that skip
				    `call` push the status pill into 1fr and it stretches.
				    For parent rows that group K parallel children, show a
				    live "X/K done · avg Yms" summary instead of an empty
				    slot so the row carries information at a glance. */}
				<span className="pg-step-call dash-mono">
					{step.call ? `${step.call.method} ${step.call.path}` : hasChildren ? formatChildSummary(children) : null}
				</span>
				{step.httpStatus != null && (
					<span className="pg-step-http dash-mono" data-tone={httpTone(step.httpStatus)}>
						{step.httpStatus}
					</span>
				)}
				{/* The HTTP status pill carries the outcome whenever a real
				    response landed (2xx/4xx/5xx). Only show the wordy pill for
				    states that have no HTTP code: pending, running, skipped,
				    network failure (status=0). Pending rows still render
				    "Waiting" — without it the row looks indistinguishable from
				    one that never existed. */}
				{(step.httpStatus == null || step.httpStatus === 0) && (
					<span className={`pg-step-pill pg-step-pill--${step.status}`}>
						{step.status === "running" && (
							<svg
								width="9"
								height="9"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2.5"
								strokeLinecap="round"
								strokeLinejoin="round"
								className="animate-spin"
								aria-hidden="true"
							>
								<path d="M21 12a9 9 0 1 1-6.2-8.55" />
							</svg>
						)}
						{STATUS_LABEL[step.status]}
					</span>
				)}
				{/* Duration always renders last so it sits at the right edge
				    regardless of whether the row shows an HTTP code, a status
				    pill, or both. Position consistency between running (live
				    counter) and complete (final ms) eliminates the visual jump
				    when the response lands. */}
				{displayMs != null && (
					<span className="pg-step-duration dash-mono">{displayMs}ms</span>
				)}
			</button>
			{expandable && open && (() => {
				const showResponse = (step.result !== undefined && !hasChildren) || step.error;
				const showWaiting = !step.call && !step.result && !step.error && !hasChildren && step.status === "running";
				const showQueued = !step.call && !step.result && !step.error && !hasChildren && step.status === "pending";
				if (!step.call && !showResponse && !showWaiting && !showQueued) return null;
				return (
					<div className="pg-step-body">
						{step.call && (
							<section className="pg-step-section">
								<header className="pg-step-section-h">
									<span>Request</span>
									<CopyButton text={curlFor(step.call, step.requestBody)} />
								</header>
								<pre className="pg-json pg-json--compact">{step.call.method} {step.call.path}</pre>
								{step.requestBody !== undefined && (
									<pre className="pg-json">{JSON.stringify(step.requestBody, null, 2)}</pre>
								)}
							</section>
						)}
						{showResponse && (
							<section className="pg-step-section">
								<header className="pg-step-section-h">
									<span>Response</span>
									{step.result !== undefined && !hasChildren && (
										<CopyButton text={JSON.stringify(step.result, null, 2)} />
									)}
								</header>
								{step.error && <p className="pg-step-error">{step.error}</p>}
								{step.result !== undefined && !hasChildren && (
									<pre className="pg-json">{JSON.stringify(step.result, null, 2)}</pre>
								)}
							</section>
						)}
						{showWaiting && <p className="pg-step-empty">Waiting for response…</p>}
						{showQueued && <p className="pg-step-empty">Queued.</p>}
					</div>
				);
			})()}
			{hasChildren && open && (
				<ul className="pg-trace-children">
					{children.map((child) => (
						<TraceChild key={child.key} step={child} />
					))}
				</ul>
			)}
		</li>
	);
}

/**
 * Live "X/K done" progress rendered in a parent step's call slot. The
 * parent already carries its own wall-time on the right; per-child
 * durations live on each child row, so the parent only needs the count.
 */
function formatChildSummary(children: Step[]): string {
	const total = children.length;
	const done = children.filter((c) => c.status === "ok" || c.status === "error").length;
	return `${done}/${total} done`;
}

/**
 * Child step inside a parent group (e.g. search.sold under search).
 * Shares the row anatomy with TraceStep but uses a `└` prefix instead
 * of a numbered index — children inherit their position from the
 * parent slot and stack vertically under it.
 */
function TraceChild({ step }: { step: Step }) {
	const [open, setOpen] = useState(false);
	// Same expandable rule as parents — pending rows have nothing to
	// drill into so they stay non-clickable.
	const expandable = step.call !== undefined || step.result !== undefined || step.error !== undefined;
	const liveMs = useLiveDuration(step.status);
	const displayMs = step.status === "running" ? liveMs : step.durationMs;
	return (
		<li className={`pg-step pg-step--child pg-step--${step.status}`}>
			<button
				type="button"
				className="pg-step-head"
				onClick={() => expandable && setOpen((o) => !o)}
				aria-expanded={expandable ? open : undefined}
				disabled={!expandable}
			>
				<span className="pg-step-num">└</span>
				<span className="pg-step-label">{step.label}</span>
				<span className="pg-step-call dash-mono">
					{step.call ? `${step.call.method} ${step.call.path}` : null}
				</span>
				{step.httpStatus != null && (
					<span className="pg-step-http dash-mono" data-tone={httpTone(step.httpStatus)}>
						{step.httpStatus}
					</span>
				)}
				{(step.httpStatus == null || step.httpStatus === 0) && (
					<span className={`pg-step-pill pg-step-pill--${step.status}`}>
						{step.status === "running" && (
							<svg
								width="9"
								height="9"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2.5"
								strokeLinecap="round"
								strokeLinejoin="round"
								className="animate-spin"
								aria-hidden="true"
							>
								<path d="M21 12a9 9 0 1 1-6.2-8.55" />
							</svg>
						)}
						{STATUS_LABEL[step.status]}
					</span>
				)}
				{displayMs != null && <span className="pg-step-duration dash-mono">{displayMs}ms</span>}
			</button>
			{expandable && open && (
				<div className="pg-step-body">
					{step.call && (
						<section className="pg-step-section">
							<header className="pg-step-section-h">
								<span>Request</span>
								<CopyButton text={curlFor(step.call, step.requestBody)} />
							</header>
							<pre className="pg-json pg-json--compact">{step.call.method} {step.call.path}</pre>
							{step.requestBody !== undefined && (
								<pre className="pg-json">{JSON.stringify(step.requestBody, null, 2)}</pre>
							)}
						</section>
					)}
					{(step.result !== undefined || step.error) && (
						<section className="pg-step-section">
							<header className="pg-step-section-h">
								<span>Response</span>
								{step.result !== undefined && (
									<CopyButton text={JSON.stringify(step.result, null, 2)} />
								)}
							</header>
							{step.error && <p className="pg-step-error">{step.error}</p>}
							{step.result !== undefined && (
								<pre className="pg-json">{JSON.stringify(step.result, null, 2)}</pre>
							)}
						</section>
					)}
					{!step.call && !step.result && !step.error && step.status === "running" && (
						<p className="pg-step-empty">Waiting for response…</p>
					)}
					{!step.call && !step.result && !step.error && step.status === "pending" && (
						<p className="pg-step-empty">Queued.</p>
					)}
				</div>
			)}
		</li>
	);
}

/**
 * Track elapsed ms while a step is in `running` state. Captures the
 * mount time when status flips to running, ticks every 100ms (smooth
 * enough to read, cheap enough to ignore), clears when status leaves.
 */
function useLiveDuration(status: Step["status"]): number | null {
	const [startedAt, setStartedAt] = useState<number | null>(null);
	const [, forceTick] = useState(0);

	useEffect(() => {
		if (status === "running") {
			setStartedAt((s) => s ?? Date.now());
		} else {
			setStartedAt(null);
		}
	}, [status]);

	useEffect(() => {
		if (status !== "running" || startedAt == null) return;
		const id = setInterval(() => forceTick((t) => t + 1), 100);
		return () => clearInterval(id);
	}, [status, startedAt]);

	return startedAt != null ? Date.now() - startedAt : null;
}

function httpTone(status: number): "ok" | "warn" | "err" {
	if (status === 0) return "err";
	if (status < 300) return "ok";
	if (status < 500) return "warn";
	return "err";
}

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			className="pg-step-copy"
			onClick={async (e) => {
				// Section headers sit inside the collapsible row's <button>; without
				// stopPropagation, clicking copy would also collapse the row.
				e.stopPropagation();
				try {
					await navigator.clipboard.writeText(text);
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				} catch {
					/* ignore */
				}
			}}
		>
			{copied ? (
				<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
					<path d="M3 8l3 3 7-7" />
				</svg>
			) : (
				<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
					<rect x="5" y="5" width="9" height="9" rx="1.5" />
					<path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
				</svg>
			)}
			{copied ? "Copied" : "Copy"}
		</button>
	);
}

/**
 * Build a runnable cURL for the trace's Request section. Uses
 * `X-API-Key: $FLIPAGENT_API_KEY` so a copy-paste reproduces the call
 * once the env var is set. Bodies are inlined as `-d` JSON.
 */
function curlFor(call: { method: "GET" | "POST"; path: string }, body: unknown): string {
	const url = `${apiBase}${call.path}`;
	const head = call.method === "GET" ? `curl '${url}' \\` : `curl -X ${call.method} '${url}' \\`;
	const lines = [head, `  -H 'X-API-Key: '"$FLIPAGENT_API_KEY"`];
	if (body !== undefined) {
		lines[lines.length - 1] += ` \\`;
		lines.push(`  -H 'Content-Type: application/json' \\`);
		const json = JSON.stringify(body).replace(/'/g, "'\\''");
		lines.push(`  -d '${json}'`);
	}
	return lines.join("\n");
}
