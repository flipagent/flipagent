/**
 * Lightweight result panel for the "Worth" mode of `/v1/evaluate`
 * (ref kind = `query` / `id`). Renders the market headline, byCondition
 * comparison, byVariant rollup, listing-floor recommendation, and
 * competition counts — no buy-decision rows (those live on
 * EvaluateResult, used in "Buy decision" mode). Full pools are reachable
 * via the JSON drawer for debug.
 */

import { useState } from "react";

type Money = { value: string; currency: string } | undefined;

interface MarketStatsLite {
	medianCents: number;
	p25Cents: number;
	p75Cents: number;
	salesPerDay: number;
	nObservations: number;
	meanDaysToSell?: number | null;
}

interface SoldDigestLite {
	count: number;
	priceCents: { p10Cents: number; p25Cents: number; p50Cents: number; p75Cents: number; p90Cents: number };
	salesPerDay: number;
	recentTrend: { direction: string; change14dPct: number } | null;
}

interface ActiveDigestLite {
	count: number;
	bestPriceCents: number | null;
	priceCents: { p25Cents: number; p50Cents: number; p75Cents: number };
}

interface ConditionSliceLite {
	conditionTier: string;
	count: number;
	market: MarketStatsLite;
}

interface VariantSummaryLite {
	variantId: string;
	variantKey: string;
	attributes: Record<string, string>;
	count: number;
	medianCents: number | null;
	salesPerDay: number;
}

interface ListingFloorLite {
	listPriceCents: number;
	expectedDaysToSell: number;
	daysLow: number;
	daysHigh: number;
	queueAhead: number;
	asksAbove: number;
}

interface AnchorLite {
	title?: string;
	itemWebUrl?: string;
	image?: { imageUrl?: string };
	price?: Money;
}

interface ProductLite {
	id: string;
	title: string;
	brand?: string;
	hasVariants: boolean;
	catalogStatus: string;
}

export interface AppraiseOutcome {
	product: ProductLite;
	variant: { variantKey?: string; attributes?: Record<string, string> } | null;
	anchor?: AnchorLite;
	market: MarketStatsLite;
	sold: SoldDigestLite;
	active: ActiveDigestLite;
	byCondition?: ConditionSliceLite[];
	byVariant?: VariantSummaryLite[];
	listingFloor: ListingFloorLite | null;
	meta: { soldCount: number; activeCount: number; soldKept: number; activeKept: number };
}

function fmtUsd(cents: number | null | undefined): string {
	if (cents == null) return "—";
	return `$${(cents / 100).toFixed(0)}`;
}

function fmtDays(d: number | null | undefined): string {
	if (d == null || !Number.isFinite(d)) return "—";
	if (d < 1) return "<1d";
	return `${d.toFixed(d < 10 ? 1 : 0)}d`;
}

export function AppraiseResult({ outcome }: { outcome: AppraiseOutcome }) {
	const [showRaw, setShowRaw] = useState(false);
	const m = outcome.market;
	const f = outcome.listingFloor;
	const variantLabel = outcome.variant?.variantKey
		? outcome.variant.variantKey.replace(/\|/g, " · ").replace(/:/g, " ")
		: null;
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
			{/* Hero */}
			<div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
				{outcome.anchor?.image?.imageUrl && (
					<img
						src={outcome.anchor.image.imageUrl}
						alt=""
						style={{ width: 64, height: 64, objectFit: "contain", borderRadius: 6, background: "var(--bg-soft)" }}
					/>
				)}
				<div style={{ flex: 1, minWidth: 0 }}>
					<div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>{outcome.product.title}</div>
					<div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
						{outcome.product.brand && <span>{outcome.product.brand}</span>}
						{variantLabel && (
							<>
								{outcome.product.brand && " · "}
								<span>{variantLabel}</span>
							</>
						)}
						{outcome.product.catalogStatus !== "curated" && (
							<>
								{" · "}
								<span style={{ color: "var(--text-3)" }}>catalog: {outcome.product.catalogStatus}</span>
							</>
						)}
					</div>
				</div>
			</div>

			{/* Headline market */}
			<div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
				<Card label="Market median">
					<div style={{ fontSize: 22, fontWeight: 600 }}>{fmtUsd(m.medianCents)}</div>
					<div style={{ fontSize: 11, color: "var(--text-3)" }}>
						IQR {fmtUsd(m.p25Cents)} – {fmtUsd(m.p75Cents)} · n={m.nObservations}
					</div>
				</Card>
				<Card label="Sells per day">
					<div style={{ fontSize: 22, fontWeight: 600 }}>{m.salesPerDay.toFixed(2)}</div>
					<div style={{ fontSize: 11, color: "var(--text-3)" }}>
						avg wait {fmtDays(m.meanDaysToSell ?? null)}
					</div>
				</Card>
				<Card label="Active competition">
					<div style={{ fontSize: 22, fontWeight: 600 }}>{outcome.active.count}</div>
					<div style={{ fontSize: 11, color: "var(--text-3)" }}>
						floor {fmtUsd(outcome.active.bestPriceCents)} · p50 {fmtUsd(outcome.active.priceCents.p50Cents)}
					</div>
				</Card>
			</div>

			{/* Listing floor — if you sold */}
			{f && (
				<div
					style={{
						padding: "12px 14px",
						border: "1px solid var(--border-faint)",
						borderRadius: 8,
						background: "var(--bg-soft)",
					}}
				>
					<div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, letterSpacing: 0.4 }}>
						SUGGESTED LIST PRICE
					</div>
					<div style={{ fontSize: 18, fontWeight: 600 }}>{fmtUsd(f.listPriceCents)}</div>
					<div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
						expected {fmtDays(f.expectedDaysToSell)} · band {fmtDays(f.daysLow)}–{fmtDays(f.daysHigh)} · queue ahead {f.queueAhead} · asks above {f.asksAbove}
					</div>
				</div>
			)}

			{/* byCondition comparison */}
			{outcome.byCondition && outcome.byCondition.length > 1 && (
				<div>
					<div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6, letterSpacing: 0.4 }}>
						BY CONDITION
					</div>
					<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
						{outcome.byCondition.map((slice) => (
							<div
								key={slice.conditionTier}
								style={{
									display: "flex",
									justifyContent: "space-between",
									padding: "6px 10px",
									border: "1px solid var(--border-faint)",
									borderRadius: 6,
									fontSize: 13,
								}}
							>
								<span style={{ textTransform: "capitalize" }}>{slice.conditionTier.replace(/_/g, " ")}</span>
								<span>
									<span style={{ fontWeight: 600 }}>{fmtUsd(slice.market.medianCents)}</span>
									<span style={{ color: "var(--text-3)", marginLeft: 8 }}>n={slice.count}</span>
								</span>
							</div>
						))}
					</div>
				</div>
			)}

			{/* byVariant comparison — sibling variants of the same product
			    (size 9 vs 10 vs 11, etc.). Cache-only: only variants with
			    a fresh product_market_cache row appear. */}
			{outcome.byVariant && outcome.byVariant.length > 0 && (
				<div>
					<div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6, letterSpacing: 0.4 }}>
						BY VARIANT
					</div>
					<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
						{outcome.byVariant.map((v) => (
							<div
								key={v.variantId}
								style={{
									display: "flex",
									justifyContent: "space-between",
									padding: "6px 10px",
									border: "1px solid var(--border-faint)",
									borderRadius: 6,
									fontSize: 13,
								}}
							>
								<span>{v.variantKey.replace(/\|/g, " · ").replace(/:/g, " ")}</span>
								<span>
									<span style={{ fontWeight: 600 }}>{fmtUsd(v.medianCents)}</span>
									<span style={{ color: "var(--text-3)", marginLeft: 8 }}>n={v.count}</span>
								</span>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Meta */}
			<div style={{ fontSize: 11, color: "var(--text-3)" }}>
				sold {outcome.meta.soldKept}/{outcome.meta.soldCount + outcome.meta.soldKept} · active {outcome.meta.activeKept}/
				{outcome.meta.activeCount + outcome.meta.activeKept}
			</div>

			<button
				type="button"
				onClick={() => setShowRaw((v) => !v)}
				style={{
					alignSelf: "flex-start",
					fontSize: 11,
					color: "var(--text-3)",
					background: "transparent",
					border: "none",
					cursor: "pointer",
					padding: 0,
				}}
			>
				{showRaw ? "Hide" : "Show"} raw JSON
			</button>
			{showRaw && (
				<pre
					style={{
						fontSize: 11,
						background: "var(--bg-soft)",
						padding: 12,
						borderRadius: 6,
						maxHeight: 400,
						overflow: "auto",
					}}
				>
					{JSON.stringify(outcome, null, 2)}
				</pre>
			)}
		</div>
	);
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div
			style={{
				padding: "10px 12px",
				border: "1px solid var(--border-faint)",
				borderRadius: 8,
			}}
		>
			<div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, letterSpacing: 0.4 }}>{label}</div>
			{children}
		</div>
	);
}
