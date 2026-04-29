/**
 * Price distribution chart — sold vs active, stacked bars by price bin,
 * with a reference line for the user's listing price. Hover any bar to
 * see the bucket range and the exact count per series.
 *
 * Built on Recharts (already in the docs site for elsewhere) so we get
 * polished tooltip + axis behaviour for free, then themed via our CSS
 * tokens so it doesn't look like a default chart-library widget.
 */

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
	label: string;
}

function buildBuckets(soldCents: number[], activeCents: number[], candidate: number | null, binCount: number): Bucket[] {
	const all = [...soldCents, ...activeCents, ...(candidate != null ? [candidate] : [])];
	if (all.length === 0) return [];
	const min = Math.min(...all);
	const max = Math.max(...all);
	if (max - min < 100) return [];

	// Pad endpoints so first/last bin doesn't sit on the edge of the chart.
	const pad = Math.max(100, (max - min) * 0.06);
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
			label: `$${Math.round(loCents / 100)}–$${Math.round(hiCents / 100)}`,
		});
	}

	function place(c: number, key: "sold" | "active") {
		const idx = Math.min(buckets.length - 1, Math.floor((c - lo) / step));
		const b = buckets[idx];
		if (b) b[key]++;
	}
	for (const c of soldCents) place(c, "sold");
	for (const c of activeCents) place(c, "active");
	return buckets;
}

export function PriceHistogram({ sold, active, candidatePriceCents, bins = 14 }: Props) {
	const soldCents = sold.map(priceCents).filter((c): c is number => c != null);
	const activeCents = active.map(priceCents).filter((c): c is number => c != null);
	const buckets = buildBuckets(soldCents, activeCents, candidatePriceCents, bins);
	if (buckets.length === 0) return null;

	const data = buckets.map((b) => ({
		bin: b.label,
		mid: b.mid / 100,
		sold: b.sold,
		active: b.active,
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
		<div className="pg-result-chart">
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
				<BarChart data={data} margin={{ top: 28, right: 16, left: 0, bottom: 4 }}>
					<CartesianGrid strokeDasharray="2 4" vertical={false} stroke="var(--border-faint)" />
					<XAxis
						dataKey="bin"
						tick={{ fontSize: 10, fill: "var(--text-3)" }}
						tickLine={false}
						axisLine={{ stroke: "var(--border-faint)" }}
						interval={Math.max(0, Math.floor(buckets.length / 7) - 1)}
					/>
					<YAxis
						allowDecimals={false}
						tick={{ fontSize: 10, fill: "var(--text-3)" }}
						tickLine={false}
						axisLine={{ stroke: "var(--border-faint)" }}
						width={28}
					/>
					<Tooltip
						cursor={{ fill: "var(--surface-2)" }}
						contentStyle={{
							background: "var(--surface)",
							border: "1px solid var(--border)",
							borderRadius: 6,
							fontSize: 12,
							padding: "6px 10px",
						}}
						labelStyle={{ color: "var(--text-3)", fontSize: 11, marginBottom: 2 }}
						itemStyle={{ color: "var(--text)", padding: 0 }}
					/>
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
