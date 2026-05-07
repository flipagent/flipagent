/**
 * Price chart — two views, one frame:
 *
 *   1. By price (default) — sold + active stacked into price bins, with
 *      a vertical reference line for the user's listing price. Answers
 *      "where in the price range does my listing sit and how thick is
 *      the competition there?"
 *
 *   2. Over time — sold + active as scatter dots over a date axis, with
 *      the user's price as a horizontal reference line. Answers "is
 *      this market still moving, and how stale is the competition?"
 *
 * Both views share the same color vocabulary (brand-orange = Active = the
 * live market you're pricing into; muted = Sold = settled history) and
 * the same legend, so users learn the chart once. A segmented toggle in
 * the chart head flips between them; the choice persists per-tab in
 * sessionStorage so re-runs don't reset it (across-tab persistence
 * deliberately avoided — this is a viewing preference, not a setting).
 *
 * Built on Recharts (already in the docs site for elsewhere) so we get
 * polished tooltip + axis behaviour for free, then themed via our CSS
 * tokens so it doesn't look like a default chart-library widget.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	ReferenceLine,
	ResponsiveContainer,
	Scatter,
	ScatterChart,
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

type ChartView = "byPrice" | "overTime";
const VIEW_STORAGE_KEY = "flipagent.priceChart.view.v1";

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

function loadView(): ChartView {
	if (typeof window === "undefined") return "byPrice";
	try {
		const v = window.sessionStorage.getItem(VIEW_STORAGE_KEY);
		return v === "overTime" ? "overTime" : "byPrice";
	} catch {
		return "byPrice";
	}
}

export function PriceHistogram({ sold, active, candidatePriceCents, bins = 14 }: Props) {
	const wrapRef = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(0);
	const [view, setView] = useState<ChartView>("byPrice");

	// Hydrate view choice on first paint (client-only).
	useEffect(() => {
		setView(loadView());
	}, []);
	useEffect(() => {
		if (typeof window === "undefined") return;
		try {
			window.sessionStorage.setItem(VIEW_STORAGE_KEY, view);
		} catch {
			// ignore quota / private mode
		}
	}, [view]);

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

	const soldCount = useMemo(() => sold.filter((s) => priceCents(s) != null).length, [sold]);
	const activeCount = useMemo(() => active.filter((a) => priceCents(a) != null).length, [active]);

	// "Over time" needs at least one sold with a date to be meaningful —
	// without dates, the scatter has nothing to plot on the X axis. Disable
	// the toggle option (rather than silently fall back) so the user
	// understands why one view is missing.
	const hasTimeData = useMemo(
		() => sold.some((s) => s.lastSoldDate) || active.some((a) => a.itemCreationDate),
		[sold, active],
	);

	return (
		<div className="pg-result-chart" ref={wrapRef}>
			<div className="pg-result-chart-head">
				<div className="pg-result-chart-head-left">
					<span className="pg-result-chart-title">
						{view === "byPrice" ? "Price distribution" : "Price over time"}
					</span>
					<ChartViewToggle view={view} onChange={setView} disabledOverTime={!hasTimeData} />
				</div>
				<span className="pg-result-chart-meta">
					<span className="pg-result-chart-key pg-result-chart-key--sold" />
					Sold {soldCount}
					<span className="pg-result-chart-key pg-result-chart-key--active" />
					Active {activeCount}
				</span>
			</div>
			{view === "byPrice" ? (
				<PriceDistributionView
					sold={sold}
					active={active}
					candidatePriceCents={candidatePriceCents}
					bins={bins}
					width={width}
				/>
			) : (
				<PriceTimelineView sold={sold} active={active} candidatePriceCents={candidatePriceCents} />
			)}
		</div>
	);
}

/* ───────── view toggle ───────── */

function ChartViewToggle({
	view,
	onChange,
	disabledOverTime,
}: {
	view: ChartView;
	onChange: (next: ChartView) => void;
	disabledOverTime: boolean;
}) {
	return (
		<div className="pg-result-chart-toggle" role="tablist" aria-label="Chart view">
			<button
				type="button"
				role="tab"
				aria-selected={view === "byPrice"}
				className="pg-result-chart-toggle-btn"
				data-active={view === "byPrice" ? "true" : undefined}
				onClick={() => onChange("byPrice")}
			>
				By price
			</button>
			<button
				type="button"
				role="tab"
				aria-selected={view === "overTime"}
				className="pg-result-chart-toggle-btn"
				data-active={view === "overTime" ? "true" : undefined}
				disabled={disabledOverTime}
				title={disabledOverTime ? "No sale-date data on these comps" : undefined}
				onClick={() => onChange("overTime")}
			>
				Over time
			</button>
		</div>
	);
}

/* ───────── view 1: distribution (price histogram) ───────── */

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

	if (min === max) {
		// Degenerate case — all observations sit on the same price, no
		// dispersion to histogram. Render one centred bin so the chart
		// still draws (instead of disappearing).
		const sortedSold = [...soldCents].sort((a, b) => a - b);
		const sortedActive = [...activeCents].sort((a, b) => a - b);
		return [
			{
				loCents: min,
				hiCents: max,
				mid: min,
				sold: soldCents.length,
				active: activeCents.length,
				soldPrices: sortedSold,
				activePrices: sortedActive,
				label: `$${Math.round(min / 100)}`,
			},
		];
	}

	// Round to "nice" widths so labels read cleanly ($60–$70 not $58.42–$71.13).
	const rawWidth = (max - min) / binCount;
	const niceSteps = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10_000, 20_000, 25_000, 50_000];
	const width = niceSteps.find((s) => s >= rawWidth) ?? Math.ceil(rawWidth / 1000) * 1000;
	const lo = Math.floor(min / width) * width;
	const hi = Math.ceil(max / width) * width;
	const buckets: Bucket[] = [];
	for (let edge = lo; edge < hi; edge += width) {
		buckets.push({
			loCents: edge,
			hiCents: edge + width,
			mid: edge + width / 2,
			sold: 0,
			active: 0,
			soldPrices: [],
			activePrices: [],
			label: `$${Math.round(edge / 100)}–$${Math.round((edge + width) / 100)}`,
		});
	}
	for (const c of soldCents) {
		const i = Math.min(buckets.length - 1, Math.max(0, Math.floor((c - lo) / width)));
		const b = buckets[i];
		if (b) {
			b.sold++;
			b.soldPrices.push(c);
		}
	}
	for (const c of activeCents) {
		const i = Math.min(buckets.length - 1, Math.max(0, Math.floor((c - lo) / width)));
		const b = buckets[i];
		if (b) {
			b.active++;
			b.activePrices.push(c);
		}
	}
	for (const b of buckets) {
		b.soldPrices.sort((a, b) => a - b);
		b.activePrices.sort((a, b) => a - b);
	}
	return buckets;
}

function PriceDistributionView({
	sold,
	active,
	candidatePriceCents,
	bins,
	width,
}: {
	sold: ItemSummary[];
	active: ItemSummary[];
	candidatePriceCents: number | null;
	bins: number;
	width: number;
}) {
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

	// Anchor the "Your $X" label so it never overflows the chart edge:
	// when the candidate bin sits in the right third, render it to the
	// LEFT of the line; left third → RIGHT of the line; middle → centered
	// above. This is what fixes the rightmost-bin clipping that the
	// stock `position: "top"` exhibits (label centered on the line, half
	// of it walks off the plot area).
	const candidateIdx = data.findIndex((d) => d.bin === candidateBinLabel);
	const candidateAnchor: "start" | "middle" | "end" =
		candidateIdx < 0 || data.length === 0
			? "middle"
			: candidateIdx >= data.length - Math.max(1, Math.floor(data.length / 3))
				? "end"
				: candidateIdx <= Math.floor(data.length / 3)
					? "start"
					: "middle";

	return (
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
				{/* Cursor = column hover behind the bar. `--surface-2` (#fafafa)
				    is too pale to read against the chart's white background;
				    --border-faint gives a faint but actually-visible band. */}
				<Tooltip cursor={{ fill: "var(--border-faint)" }} content={<HistogramTooltip />} />
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
							textAnchor: candidateAnchor,
							// Nudge label off the line slightly when anchored to
							// a side so it doesn't overlap the dashed stroke.
							dx: candidateAnchor === "end" ? -4 : candidateAnchor === "start" ? 4 : 0,
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
	);
}

/* ───────── view 2: timeline (price scatter) ───────── */

interface TimelinePoint {
	t: number; // unix ms
	price: number; // dollars
}

function parseDateMs(iso: string | undefined): number | null {
	if (!iso) return null;
	const ms = Date.parse(iso);
	return Number.isFinite(ms) ? ms : null;
}

function PriceTimelineView({
	sold,
	active,
	candidatePriceCents,
}: {
	sold: ItemSummary[];
	active: ItemSummary[];
	candidatePriceCents: number | null;
}) {
	const soldPoints: TimelinePoint[] = useMemo(
		() =>
			sold
				.map((s) => {
					const t = parseDateMs(s.lastSoldDate);
					const cents = priceCents(s);
					return t != null && cents != null ? { t, price: cents / 100 } : null;
				})
				.filter((p): p is TimelinePoint => p != null),
		[sold],
	);
	const activePoints: TimelinePoint[] = useMemo(
		() =>
			active
				.map((a) => {
					const t = parseDateMs(a.itemCreationDate);
					const cents = priceCents(a);
					return t != null && cents != null ? { t, price: cents / 100 } : null;
				})
				.filter((p): p is TimelinePoint => p != null),
		[active],
	);
	if (soldPoints.length === 0 && activePoints.length === 0) return null;

	const allTimes = [...soldPoints, ...activePoints].map((p) => p.t);
	const tMin = Math.min(...allTimes);
	const tMax = Math.max(...allTimes, Date.now());
	// Pad the X domain by 3% on each side so dots near the edges aren't
	// clipped by the axis line.
	const pad = Math.max(86_400_000, (tMax - tMin) * 0.03);
	const xDomain: [number, number] = [tMin - pad, tMax + pad];

	const candidatePrice = candidatePriceCents != null ? candidatePriceCents / 100 : null;

	return (
		<ResponsiveContainer width="100%" height={210}>
			{/* ScatterChart (not ComposedChart) — purpose-built for multiple
			    Scatter series with per-dot hover. ComposedChart's axis-
			    trigger tooltip only resolves the first registered series'
			    data when each Scatter passes its own `data` prop, so
			    hovering an Active dot wouldn't fire. */}
			<ScatterChart margin={{ top: 28, right: 16, left: 4, bottom: 4 }}>
				<CartesianGrid strokeDasharray="2 4" vertical={false} stroke="var(--border-faint)" />
				<XAxis
					dataKey="t"
					type="number"
					domain={xDomain}
					scale="time"
					tickFormatter={formatDateTick}
					tick={{ fontSize: 10, fill: "var(--text-3)" }}
					tickLine={false}
					axisLine={{ stroke: "var(--border-faint)" }}
					/* Recharts needs `allowDuplicatedCategory={false}` on a
					 * shared numeric X to stop it injecting a per-series
					 * category axis; we use type="number" so this is moot,
					 * but keep the explicit hint for safety. */
					allowDuplicatedCategory={false}
				/>
				<YAxis
					dataKey="price"
					type="number"
					tickFormatter={(v: number) => `$${Math.round(v)}`}
					tick={{ fontSize: 10, fill: "var(--text-3)" }}
					tickLine={false}
					axisLine={{ stroke: "var(--border-faint)" }}
					width={36}
				/>
				{/* Cursor = vertical hover guide. `--surface-2` (#fafafa) is
				    basically invisible against white — bump to `--text-4`
				    (#a3a3a3) and dash it so it reads as a hover guide,
				    not a data line. */}
				<Tooltip
					cursor={{ stroke: "var(--text-4)", strokeDasharray: "3 3", strokeWidth: 1 }}
					content={<TimelineTooltip candidatePrice={candidatePrice} />}
				/>
				{candidatePrice != null && (
					<ReferenceLine
						y={candidatePrice}
						stroke="var(--text)"
						strokeDasharray="3 3"
						label={{
							/* `insideTopRight` keeps the label inside the
							 * plot area — `right` puts it in the chart's
							 * 16px right margin where it gets clipped. */
							position: "insideTopRight",
							value: `Your $${Math.round(candidatePrice)}`,
							fill: "var(--text)",
							fontSize: 11,
							offset: 6,
						}}
					/>
				)}
				<Scatter
					data={soldPoints}
					name="Sold"
					fill="var(--text-4)"
					shape="circle"
					isAnimationActive={false}
				/>
				<Scatter
					data={activePoints}
					name="Active"
					fill="var(--brand)"
					shape="circle"
					isAnimationActive={false}
				/>
			</ScatterChart>
		</ResponsiveContainer>
	);
}

function formatDateTick(ms: number): string {
	const d = new Date(ms);
	return `${d.toLocaleString("en-US", { month: "short" })} ${d.getDate()}`;
}

/* ───────── tooltips ───────── */

interface TooltipProps {
	active?: boolean;
	label?: string | number;
	payload?: Array<{
		name?: string;
		payload?: {
			soldPrices?: number[];
			activePrices?: number[];
			t?: number;
			price?: number;
		};
	}>;
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

/** Timeline tooltip — single-point view. Whichever scatter dot the
 * cursor lands on shows up first; the y reference line shows the user's
 * price for reference. Recharts feeds `payload[0]` with the hovered
 * series' datum. */
function TimelineTooltip({
	active,
	payload,
	candidatePrice,
}: TooltipProps & { candidatePrice: number | null }) {
	if (!active || !payload?.length) return null;
	const top = payload[0];
	const datum = top?.payload;
	if (!datum || datum.t == null || datum.price == null) return null;
	const series = top?.name === "Active" ? "active" : "sold";
	const dot = series === "active" ? "var(--brand)" : "var(--text-4)";
	const seriesLabel = series === "active" ? "Active" : "Sold";
	const dateStr = new Date(datum.t).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
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
			}}
		>
			<div style={{ color: "var(--text-3)", fontSize: 11, marginBottom: 6 }}>{dateStr}</div>
			<div style={{ display: "flex", gap: 8, alignItems: "baseline", lineHeight: 1.45 }}>
				<span
					aria-hidden
					style={{
						width: 8,
						height: 8,
						borderRadius: 999,
						background: dot,
						display: "inline-block",
						flexShrink: 0,
						transform: "translateY(1px)",
					}}
				/>
				<span style={{ color: "var(--text-3)", fontSize: 11, minWidth: 80 }}>{seriesLabel}</span>
				<span style={{ color: "var(--text)", fontFamily: "var(--mono)", fontSize: 11 }}>
					${Math.round(datum.price)}
				</span>
			</div>
			{candidatePrice != null && (
				<div
					style={{ display: "flex", gap: 8, alignItems: "baseline", lineHeight: 1.45, marginTop: 2 }}
				>
					<span
						aria-hidden
						style={{
							width: 8,
							borderTop: "1.5px dashed var(--text)",
							display: "inline-block",
							flexShrink: 0,
							transform: "translateY(-3px)",
						}}
					/>
					<span style={{ color: "var(--text-3)", fontSize: 11, minWidth: 80 }}>Your price</span>
					<span style={{ color: "var(--text)", fontFamily: "var(--mono)", fontSize: 11 }}>
						${Math.round(candidatePrice)}
					</span>
				</div>
			)}
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
