/**
 * Evaluate result — three blocks:
 *
 *   1. Item hero (image + title + price)
 *   2. Comparison (usually vs this listing — the only stats a casual
 *      reader needs to grasp the verdict)
 *   3. Recommendation (BUY / PASS / SKIP + plain-English reason)
 *
 * Engineer-level breakdown (matches/borderline/rejected, IQR, sales-per-day,
 * 50 past sales count, ...) lives behind the "How this was calculated"
 * expander at the bottom. The default view is reseller-friendly: two
 * lines of plain English say "this listing is $X above what it usually
 * sells for" and the call follows naturally.
 */

import { motion } from "motion/react";
import { useState } from "react";
import { Trace } from "./Trace";
import type { EvaluateOutcome } from "./pipelines";
import type { ItemDetail, Step, Verdict } from "./types";

const RATING_TONE: Record<string, string> = {
	buy: "good",
	pass: "warn",
	skip: "neutral",
};

function fmtUsdRound(cents: number | undefined | null): string {
	if (cents == null) return "—";
	const sign = cents < 0 ? "−" : "";
	return `${sign}$${Math.abs(Math.round(cents / 100))}`;
}

function fmtUsdExact(cents: number | undefined | null): string {
	if (cents == null) return "—";
	const sign = cents < 0 ? "−" : "";
	return `${sign}$${Math.abs(cents / 100).toFixed(2)}`;
}

export function EvaluateResult({
	outcome,
	steps,
}: {
	outcome: EvaluateOutcome;
	steps: Step[];
}) {
	return (
		<motion.div
			className="pg-result"
			initial={{ opacity: 0, y: 4 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.25 }}
		>
			<ItemHero item={outcome.detail} />

			<Comparison outcome={outcome} />

			<Recommendation verdict={outcome.verdict} />

			<Footer payload={outcome} steps={steps} />
		</motion.div>
	);
}

/* ----------------------------- item hero ----------------------------- */

function ItemHero({ item }: { item: ItemDetail }) {
	const img = item.image?.imageUrl;
	return (
		<a
			href={item.itemWebUrl}
			target="_blank"
			rel="noopener noreferrer"
			className="pg-result-hero"
		>
			<div className="pg-result-hero-thumb">
				{img ? <img src={img} alt="" loading="lazy" /> : <span aria-hidden="true">·</span>}
			</div>
			<div className="pg-result-hero-body">
				<div className="pg-result-hero-title">{item.title}</div>
				<div className="pg-result-hero-meta">
					{item.condition && <span>{item.condition}</span>}
					{item.brand && <span>{item.brand}</span>}
					{item.price && <span className="font-mono">${item.price.value}</span>}
				</div>
			</div>
			<svg
				className="pg-result-hero-link"
				width="13"
				height="13"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				<path d="M9 3h4v4M13 3 7 9M7 5H4.5A1.5 1.5 0 0 0 3 6.5v5A1.5 1.5 0 0 0 4.5 13h5a1.5 1.5 0 0 0 1.5-1.5V9" />
			</svg>
		</a>
	);
}

/* ---------------------------- comparison ---------------------------- */

function Comparison({ outcome }: { outcome: EvaluateOutcome }) {
	const median = outcome.thesis.market.medianCents;
	const candCents = outcome.detail.price ? Math.round(Number.parseFloat(outcome.detail.price.value) * 100) : null;
	const delta = candCents != null && median != null ? candCents - median : null;

	let deltaLabel: string | null = null;
	let deltaTone: "good" | "warn" | null = null;
	if (delta != null) {
		const abs = Math.abs(delta) / 100;
		if (Math.abs(delta) < 100) {
			deltaLabel = "around market";
			deltaTone = null;
		} else if (delta > 0) {
			deltaLabel = `$${Math.round(abs)} above market`;
			deltaTone = "warn";
		} else {
			deltaLabel = `$${Math.round(abs)} below market`;
			deltaTone = "good";
		}
	}

	return (
		<dl className="pg-result-compare">
			<div>
				<dt>Usually sells for</dt>
				<dd>{fmtUsdExact(median)}</dd>
			</div>
			<div>
				<dt>This listing</dt>
				<dd>
					{candCents != null ? fmtUsdExact(candCents) : "—"}
					{deltaLabel && (
						<span className={`pg-result-delta${deltaTone ? ` pg-result-delta--${deltaTone}` : ""}`}>
							{deltaLabel}
						</span>
					)}
				</dd>
			</div>
		</dl>
	);
}

/* --------------------------- recommendation --------------------------- */

function Recommendation({ verdict }: { verdict: Verdict }) {
	const tone = RATING_TONE[verdict.rating ?? ""] ?? "neutral";
	const lines = explain(verdict);
	return (
		<section className="pg-result-rec">
			<div className={`pg-result-rec-rating pg-result-rec-rating--${tone}`}>
				{(verdict.rating ?? "—").toUpperCase()}
			</div>
			{lines.map((line) => (
				<p key={line} className="pg-result-rec-line">
					{line}
				</p>
			))}
		</section>
	);
}

/**
 * Convert verdict numbers + reason into 1–2 plain-English sentences a
 * non-reseller can grasp without a finance vocabulary. We keep the raw
 * `verdict.reason` for the trace expander; this is the friendly version.
 */
function explain(verdict: Verdict): string[] {
	const out: string[] = [];
	const net = verdict.netCents;
	if (net != null) {
		const abs = Math.abs(Math.round(net / 100));
		if (net > 0) {
			out.push(`You'd net about $${abs} after fees and shipping.`);
		} else if (net < 0) {
			out.push(`You'd lose about $${abs} after fees and shipping.`);
		} else {
			out.push(`You'd break even after fees and shipping.`);
		}
	}
	const ceiling = verdict.bidCeilingCents;
	if (ceiling != null) {
		out.push(`A safe bid is no more than $${Math.round(ceiling / 100)}.`);
	}
	return out;
}

/* ----------------------------- footer (copy + trace) ----------------------------- */

function Footer({ payload, steps }: { payload: unknown; steps: Step[] }) {
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState(false);
	async function copy() {
		try {
			await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			/* ignore */
		}
	}
	return (
		<div className="pg-result-foot">
			<div className="pg-result-foot-row">
				<button type="button" onClick={copy} className="pg-result-copy">
					<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
						<rect x="5" y="5" width="9" height="9" rx="1.5" />
						<path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
					</svg>
					{copied ? "Copied" : "Copy JSON"}
				</button>
				<button type="button" className="pg-result-trace-toggle" onClick={() => setOpen((o) => !o)}>
					<svg
						width="9"
						height="9"
						viewBox="0 0 10 10"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.6"
						strokeLinecap="round"
						strokeLinejoin="round"
						className={open ? "rotate-180" : ""}
						style={{ transition: "transform 150ms ease" }}
					>
						<path d="m3 4 2 2 2-2" />
					</svg>
					{open ? "Hide" : "How this was calculated"}
				</button>
			</div>
			{open && (
				<div className="pg-result-trace-body">
					<Trace steps={steps} />
				</div>
			)}
		</div>
	);
}
