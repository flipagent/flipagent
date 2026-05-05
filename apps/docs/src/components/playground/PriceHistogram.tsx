/**
 * Price distribution chart — sold vs active, stacked bars by price bin,
 * with a reference line for the user's listing price. Hover any bar to
 * see the bucket range and the exact count per series.
 *
 * Built on Recharts (already in the docs site for elsewhere) so we get
 * polished tooltip + axis behaviour for free, then themed via our CSS
 * tokens so it doesn't look like a default chart-library widget.
 */

import { useEffect, useRef, useState } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Legend,
	ReferenceLine,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import type { ItemSummary } from "./types";

/** Width below which we switch from the playground's original "show 14
 * bins, skip every other label" layout to "show fewer bins, every label
 * visible". 540px is roughly where 7 visible `$103–$155` labels (each
 * ~50px) start to overlap given the chart's plot area
 * (container − YAxis 28 − margins 20 ≈ 60px/label budget). */
const NARROW_THRESHOLD_PX = 540;

/** Histogram bin count that lets every X-axis label render in full
 * without overlap. fontSize-10 Geist sans `$103–$155` ≈ 50px + ~10px
 * gap = 60px/label. Plot area = width − 48px (YAxis 28 + margins 20). */
function pickNarrowBins(containerWidth: number, requested: number): number {
	const fit = Math.max(3, Math.floor((containerWidth - 48) / 60));
	return Math.min(requested, fit);
}

interface Props {
	sold: ItemSummary[];
	active: ItemSummary[];
	candidatePriceCents: number | null;
	/** Optional `bins` count for the histogram. Default 14. */
	bins?: number;
}

function priceCents(item: ItemSummary): number | null {
	const v = item.lastSoldPrice?.value ?? item.price?.value;
	if (!v) return null;
	const n = Number.parseFloat(v);
	if (!Number.isFinite(n)) return null;
	return Math.round(n * 100);
}

interface Bucket {
	loCents: number;
	hiCents: number;
	mid: number;
	sold: number;
	active: number;
	/** Actual cent values of every sold listing in this bin — surfaced
	 * in the tooltip so the user sees the individual prices, not just
	 * a count. Sorted ascending. */
	soldPrices: number[];
	activePrices: number[];
	label: string;
}

function buildBuckets(soldCents: number[], activeCents: number[], candidate: number | null, binCount: number): Bucket[] {
	const all = [...soldCents, ...activeCents, ...(candidate != null ? [candidate] : [])];
	if (all.length === 0) return [];
	const min = Math.min(...all);
	const max = Math.max(...all);

	// Pad endpoints so the first / last bin doesn't sit on the edge of
	// the chart. Single data point (or near-zero spread) widens the
	// pad to ~20% of the value so the lone bar lands clearly in the
	// middle of a visible range instead of squeezing into a 1px slice.
	const span = max - min;
	const pad = span < 100
		? Math.max(2000, Math.round(max * 0.2))
		: Math.max(100, Math.round(span * 0.06));
	const lo = Math.max(0, min - pad);
	const hi = max + pad;
	const step = Math.max(1, Math.round((hi - lo) / binCount));

	const buckets: Bucket[] = [];
	for (let i = 0; i < binCount; i++) {
		const loCents = lo + i * step;
		const hiCents = i === binCount - 1 ? hi : loCents + step;
		buckets.push({
			loCents,
			hiCents,
			mid: Math.round((loCents + hiCents) / 2),
			sold: 0,
			active: 0,
			soldPrices: [],
			activePrices: [],
			label: `$${Math.round(loCents / 100)}–$${Math.round(hiCents / 100)}`,
		});
	}

	function place(c: number, key: "sold" | "active") {
		const idx = Math.min(buckets.length - 1, Math.floor((c - lo) / step));
		const b = buckets[idx];
		if (!b) return;
		b[key]++;
		(key === "sold" ? b.soldPrices : b.activePrices).push(c);
	}
	for (const c of soldCents) place(c, "sold");
	for (const c of activeCents) place(c, "active");
	for (const b of buckets) {
		b.soldPrices.sort((a, z) => a - z);
		b.activePrices.sort((a, z) => a - z);
	}
	return buckets;
}

export function PriceHistogram({ sold, active, candidatePriceCents, bins = 14 }: Props) {
	const wrapRef = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(0);
	useEffect(() => {
		const el = wrapRef.current;
		if (!el) return;
		const ro = new ResizeObserver((entries) => {
			const w = entries[0]?.contentRect.width ?? 0;
			if (w > 0) setWidth(w);
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const isNarrow = width > 0 && width < NARROW_THRESHOLD_PX;
	const effectiveBins = isNarrow ? pickNarrowBins(width, bins) : bins;

	const soldCents = sold.map(priceCents).filter((c): c is number => c != null);
	const activeCents = active.map(priceCents).filter((c): c is number => c != null);
	const buckets = buildBuckets(soldCents, activeCents, candidatePriceCents, effectiveBins);
	if (buckets.length === 0) return null;

	const data = buckets.map((b) => ({
		bin: b.label,
		mid: b.mid / 100,
		sold: b.sold,
		active: b.active,
		soldPrices: b.soldPrices,
		activePrices: b.activePrices,
	}));

	const candidatePrice = candidatePriceCents != null ? candidatePriceCents / 100 : null;
	// Find the bin nearest the user's price — `ReferenceLine` on a category
	// X axis keys off the literal bin label, not a numeric value.
	const candidateBinLabel =
		candidatePrice != null && data.length > 0
			? data.reduce((best, d) => (Math.abs(d.mid - candidatePrice) < Math.abs(best.mid - candidatePrice) ? d : best))
					.bin
			: null;

	return (
		<div className="pg-result-chart" ref={wrapRef}>
			<div className="pg-result-chart-head">
				<span className="pg-result-chart-title">Price distribution</span>
				<span className="pg-result-chart-meta">
					<span className="pg-result-chart-key pg-result-chart-key--sold" />
					Sold {soldCents.length}
					<span className="pg-result-chart-key pg-result-chart-key--active" />
					Active {activeCents.length}
				</span>
			</div>
			<ResponsiveContainer width="100%" height={210}>
				<BarChart data={data} margin={{ top: 28, right: 16, left: 4, bottom: 4 }}>
					<CartesianGrid strokeDasharray="2 4" vertical={false} stroke="var(--border-faint)" />
					<XAxis
						dataKey="bin"
						tick={{ fontSize: 10, fill: "var(--text-3)" }}
						tickLine={false}
						axisLine={{ stroke: "var(--border-faint)" }}
						/* Wide layouts keep the original "14 bins + skip every
						 * other label" density. Narrow layouts already trimmed
						 * the bin count to fit, so every tick is shown. */
						interval={isNarrow ? 0 : Math.max(0, Math.floor(buckets.length / 7) - 1)}
					/>
					<YAxis
						allowDecimals={false}
						tick={{ fontSize: 10, fill: "var(--text-3)" }}
						tickLine={false}
						axisLine={{ stroke: "var(--border-faint)" }}
						width={28}
					/>
					<Tooltip cursor={{ fill: "var(--surface-2)" }} content={<HistogramTooltip />} />
					{candidateBinLabel != null && (
						<ReferenceLine
							x={candidateBinLabel}
							stroke="var(--text)"
							strokeDasharray="3 3"
							label={{
								position: "top",
								value: `Your $${Math.round(candidatePrice ?? 0)}`,
								fill: "var(--text)",
								fontSize: 11,
							}}
						/>
					)}
					{/* Color rationale: Active = current competition (the live
					    market the user is pricing into). Brand-orange highlights
					    that "what I'm up against right now" view. Sold = historical
					    truth, useful but already settled — sits muted. */}
					<Bar dataKey="active" stackId="dist" fill="var(--brand)" radius={[2, 2, 0, 0]} name="Active" />
					<Bar dataKey="sold" stackId="dist" fill="var(--text-4)" radius={[2, 2, 0, 0]} name="Sold" />
				</BarChart>
			</ResponsiveContainer>
		</div>
	);
}

interface TooltipProps {
	active?: boolean;
	label?: string;
	payload?: Array<{ payload?: { soldPrices?: number[]; activePrices?: number[] } }>;
}

/** Custom tooltip — replaces Recharts' default "Active: 2 / Sold: 7"
 * count pair with the actual price values that fall in this bin, so
 * the user reads concrete comps instead of just frequencies.
 *
 * Visual spacing + colors mirror the chart legend (`pg-result-chart-key`)
 * so Active = brand-orange, Sold = muted, Your price reference matches
 * the dashed reference line. */
function HistogramTooltip({ active, label, payload }: TooltipProps) {
	if (!active || !payload?.length) return null;
	const datum = payload[0]?.payload;
	if (!datum) return null;
	const sold = datum.soldPrices ?? [];
	const activeP = datum.activePrices ?? [];
	if (sold.length === 0 && activeP.length === 0) return null;
	return (
		<div
			style={{
				background: "var(--surface)",
				border: "1px solid var(--border)",
				borderRadius: 6,
				padding: "8px 10px",
				fontSize: 12,
				color: "var(--text)",
				minWidth: 140,
				maxWidth: 220,
			}}
		>
			<div style={{ color: "var(--text-3)", fontSize: 11, marginBottom: 6 }}>{label}</div>
			{activeP.length > 0 && <PriceLine label={`Active ${activeP.length}`} prices={activeP} accent="brand" />}
			{sold.length > 0 && <PriceLine label={`Sold ${sold.length}`} prices={sold} accent="muted" />}
		</div>
	);
}

function PriceLine({ label, prices, accent }: { label: string; prices: number[]; accent: "brand" | "muted" }) {
	const dot = accent === "brand" ? "var(--brand)" : "var(--text-4)";
	return (
		<div style={{ display: "flex", gap: 8, alignItems: "baseline", lineHeight: 1.45 }}>
			<span
				aria-hidden
				style={{
					width: 8,
					height: 8,
					borderRadius: 2,
					background: dot,
					display: "inline-block",
					flexShrink: 0,
					transform: "translateY(1px)",
				}}
			/>
			<span style={{ color: "var(--text-3)", fontSize: 11, minWidth: 56 }}>{label}</span>
			<span style={{ color: "var(--text)", fontFamily: "var(--mono)", fontSize: 11 }}>
				{prices.map((c) => `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`).join(", ")}
			</span>
		</div>
	);
}
