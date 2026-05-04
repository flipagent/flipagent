/**
 * Inline UI for `flipagent_get_evaluate_job` (when completed) — shows
 * the headline verdict + a few key numbers in a card. Minimal V1; the
 * full evaluator UI (`PlaygroundEvaluate.EvaluateResult`) renders
 * inside the playground tab. Keep this lean so the demo loop reads
 * cleanly inside chat.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import "./Embed.css";
import "./EmbedEvaluate.css";

type Rating = "buy" | "hold" | "skip" | string;

interface Money {
	value: number;
	currency: string;
}

interface ItemSummary {
	id?: string;
	title?: string;
	url?: string;
	price?: Money;
	images?: string[];
	condition?: string;
}

interface Evaluation {
	rating?: Rating;
	reason?: string;
	expectedNetCents?: number;
	bidCeilingCents?: number;
	confidence?: string;
	netRangeCents?: { lowCents?: number; highCents?: number };
	recommendedExit?: string;
}

interface SoldDigest {
	priceCents?: { p10?: number; p50?: number; p90?: number };
	salesPerDay?: number;
	recentTrend?: { direction?: string; pctChange?: number };
	sampleSize?: number;
}

interface EvaluateDigest {
	item?: ItemSummary;
	evaluation?: Evaluation;
	sold?: SoldDigest;
	meta?: { source?: string };
}

interface VariationOption {
	variationId: string;
	priceCents: number | null;
	currency: string;
	aspects: Array<{ name: string; value: string }>;
}

interface InitPayload {
	jobId?: string;
	status?: string;
	result?: EvaluateDigest;
	errorCode?: string;
	errorMessage?: string;
	details?: { legacyId?: string; variations?: VariationOption[] };
}

function fmtUsd(cents?: number | null): string {
	if (cents == null) return "—";
	const sign = cents < 0 ? "−" : "";
	return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function postToHost(msg: Record<string, unknown>) {
	window.parent.postMessage({ ...msg, source: "flipagent-embed" }, "*");
}

function reportSize() {
	const h = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0);
	postToHost({ type: "embed-resize", height: h });
}

export function EmbedEvaluateResult() {
	const [data, setData] = useState<InitPayload | null>(null);
	const rootRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		function onMessage(e: MessageEvent) {
			const m = e.data as { type?: string; data?: InitPayload } | null;
			if (!m || typeof m !== "object") return;
			if (m.type === "embed-init" && m.data) setData(m.data);
		}
		window.addEventListener("message", onMessage);
		postToHost({ type: "embed-ready", kind: "evaluate" });
		return () => window.removeEventListener("message", onMessage);
	}, []);

	useEffect(() => {
		const el = rootRef.current;
		if (!el) return;
		const obs = new ResizeObserver(() => reportSize());
		obs.observe(el);
		reportSize();
		return () => obs.disconnect();
	}, []);

	const result = useMemo(() => data?.result, [data]);
	const item = result?.item;
	const evaln = result?.evaluation;
	const sold = result?.sold;

	if (data && data.errorCode === "variation_required" && data.details?.variations?.length) {
		const variations = data.details.variations;
		const legacyId = data.details.legacyId;
		return (
			<div ref={rootRef} className="embed-card embed-eval embed-eval-variations">
				<header className="embed-eval-error-body">
					<span className="embed-eval-error-kicker">Pick a variation</span>
					<p className="embed-eval-error-msg">
						This listing has {variations.length} variations. Click one to evaluate that exact SKU.
					</p>
				</header>
				<ul className="embed-eval-var-list">
					{variations.map((v) => {
						const aspects = v.aspects.map((a) => `${a.name}: ${a.value}`).join(" · ");
						const priceLabel = v.priceCents != null ? fmtUsd(v.priceCents) : "—";
						return (
							<li key={v.variationId}>
								<button
									type="button"
									className="embed-eval-var-btn"
									onClick={() =>
										postToHost({
											type: "embed-tool",
											name: "flipagent_evaluate_item",
											args: legacyId ? { itemId: `v1|${legacyId}|${v.variationId}` } : { itemId: v.variationId },
											label: `Evaluate ${aspects || `variation ${v.variationId}`}`,
											subject: {
												title: aspects || `Variation ${v.variationId}`,
												subtitle: priceLabel,
											},
										})
									}
								>
									<span className="embed-eval-var-aspects">{aspects || `Variation ${v.variationId}`}</span>
									<span className="embed-eval-var-price">{priceLabel}</span>
								</button>
							</li>
						);
					})}
				</ul>
			</div>
		);
	}

	if (data && data.errorCode === "rate_limited" && data.jobId) {
		return (
			<div ref={rootRef} className="embed-card embed-eval embed-eval-error">
				<div className="embed-eval-error-body">
					<span className="embed-eval-error-kicker">Rate-limited</span>
					<p className="embed-eval-error-msg">
						{data.errorMessage ?? "Polling hit the per-minute API limit before the result came back."}
					</p>
				</div>
				<div className="embed-eval-actions">
					<button
						type="button"
						className="embed-action embed-action-primary"
						onClick={() =>
							postToHost({
								type: "embed-tool",
								name: "flipagent_get_evaluate_job",
								args: { jobId: data.jobId },
								label: "Retry the evaluation",
								subject: { title: "Retry evaluation", subtitle: data.jobId },
							})
						}
					>
						Retry
					</button>
				</div>
			</div>
		);
	}

	if (!data || (data.status && data.status !== "completed") || !data.result) {
		return (
			<div ref={rootRef} className="embed-card embed-eval embed-skeleton">
				<header className="embed-eval-hero">
					<span className="skel skel-thumb skel-thumb-lg" />
					<div className="embed-eval-id">
						<span className="skel skel-bar" style={{ width: "70%", height: 13 }} />
						<span className="skel skel-bar" style={{ width: 90, height: 11 }} />
					</div>
					<span className="skel skel-pill skel-pill-lg" />
				</header>
				<div className="embed-eval-reason embed-skeleton-reason">
					<span className="skel skel-bar" style={{ width: "92%", height: 11 }} />
					<span className="skel skel-bar" style={{ width: "76%", height: 11 }} />
				</div>
				<dl className="embed-eval-stats">
					{Array.from({ length: 6 }).map((_, i) => (
						<div key={i}>
							<span className="skel skel-bar" style={{ width: 56, height: 9 }} />
							<span className="skel skel-bar" style={{ width: 70, height: 13 }} />
						</div>
					))}
				</dl>
				<div className="embed-eval-actions">
					<span className="skel skel-pill" style={{ width: 48 }} />
					<span className="skel skel-pill" style={{ width: 78 }} />
					<span className="skel skel-pill" style={{ width: 90 }} />
				</div>
			</div>
		);
	}

	const rating = (evaln?.rating ?? "hold") as Rating;
	const itemId = item?.id;
	const itemUrl = item?.url;

	return (
		<div ref={rootRef} className="embed-card embed-eval">
			<header className="embed-eval-hero">
				{item?.images?.[0] ? (
					<img src={item.images[0]} alt="" className="embed-eval-thumb" />
				) : (
					<div className="embed-eval-thumb embed-thumb-placeholder" />
				)}
				<div className="embed-eval-id">
					<a
						href={itemUrl ?? "#"}
						target="_blank"
						rel="noopener noreferrer"
						className="embed-eval-title"
						onClick={(e) => {
							if (!itemUrl) return;
							e.preventDefault();
							postToHost({ type: "embed-link", url: itemUrl });
						}}
					>
						{item?.title ?? "(unknown item)"}
					</a>
					<div className="embed-eval-listprice">
						{item?.price ? <strong>{fmtUsd(item.price.value)}</strong> : null}
						{item?.condition && <span className="embed-eval-cond">{item.condition}</span>}
					</div>
				</div>
				<span className={`embed-eval-rating embed-eval-rating-${String(rating).toLowerCase()}`}>{rating}</span>
			</header>

			{evaln?.reason && <p className="embed-eval-reason">{evaln.reason}</p>}

			<dl className="embed-eval-stats">
				<div>
					<dt>Expected net</dt>
					<dd>{fmtUsd(evaln?.expectedNetCents)}</dd>
				</div>
				<div>
					<dt>Bid ceiling</dt>
					<dd>{fmtUsd(evaln?.bidCeilingCents)}</dd>
				</div>
				<div>
					<dt>Sold p50</dt>
					<dd>{fmtUsd(sold?.priceCents?.p50)}</dd>
				</div>
				<div>
					<dt>Sales/day</dt>
					<dd>{sold?.salesPerDay != null ? sold.salesPerDay.toFixed(2) : "—"}</dd>
				</div>
				<div>
					<dt>Trend</dt>
					<dd>
						{sold?.recentTrend?.direction ?? "—"}
						{sold?.recentTrend?.pctChange != null
							? ` (${(sold.recentTrend.pctChange * 100).toFixed(1)}%)`
							: ""}
					</dd>
				</div>
				<div>
					<dt>Sample</dt>
					<dd>{sold?.sampleSize ?? "—"} sold</dd>
				</div>
			</dl>

			<div className="embed-eval-actions">
				{itemId && (
					<button
						type="button"
						className="embed-action embed-action-primary"
						onClick={() =>
							postToHost({
								type: "embed-tool",
								name: "flipagent_create_purchase",
								args: { itemId },
								label: "Buy this item",
								subject: {
									...(item?.images?.[0] ? { image: item.images[0] } : {}),
									...(item?.title ? { title: item.title } : {}),
									...(item?.price ? { subtitle: fmtUsd(item.price.value) } : {}),
									...(itemUrl ? { url: itemUrl } : {}),
								},
							})
						}
					>
						Buy
					</button>
				)}
				{itemId && (
					<button
						type="button"
						className="embed-action"
						onClick={() =>
							postToHost({
								type: "embed-tool",
								name: "flipagent_get_evaluation_pool",
								args: { itemId },
								label: "Show comps for this item",
								subject: {
									...(item?.images?.[0] ? { image: item.images[0] } : {}),
									...(item?.title ? { title: item.title } : {}),
									...(item?.price ? { subtitle: fmtUsd(item.price.value) } : {}),
									...(itemUrl ? { url: itemUrl } : {}),
								},
							})
						}
					>
						See comps
					</button>
				)}
				{itemUrl && (
					<button
						type="button"
						className="embed-action"
						onClick={() => postToHost({ type: "embed-link", url: itemUrl })}
					>
						Open on eBay
					</button>
				)}
			</div>
		</div>
	);
}
