/**
 * Top deals — admin-only browse over every completed evaluate job in the
 * DB, deduped to one row per itemId (latest snapshot wins) and sorted by
 * expected net profit DESC. Reuses the playground compose-card chrome
 * (tabs + filter bar) so users can switch over to Search / Evaluate
 * without leaving the surface; the result table itself is purpose-built
 * for numerical scanning across many rows (E[net] in its own column,
 * tabular-nums everywhere). Goes public eventually — the underlying
 * `/v1/admin/evaluations` route gets re-mounted under `/v1/evaluations`
 * when the public surface is ready.
 */

import type { AdminEvaluationList, AdminEvaluationRow, EvaluateResponse } from "@flipagent/types";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "../../lib/authClient";
import {
	ComposeCard,
	ComposeFilters,
	ComposeOutput,
	ComposeTabs,
	type ComposeTab,
} from "../compose/ComposeCard";
import { FilterPill } from "../compose/FilterPill";
import { seedEvalForItem } from "./evalStore";
import { RowDrawer } from "./RowDrawer";
import type { EvaluateOutcome } from "./pipelines";
import type { ItemSummary } from "./types";
import "./PlaygroundDeals.css";

type Rating = "buy" | "skip";
type SortKey = "net_desc" | "net_asc" | "recent";

interface DealsQuery {
	q: string;
	rating: "" | Rating;
	minNetDollars: string;
	sort: SortKey;
}

const EMPTY: DealsQuery = { q: "", rating: "", minNetDollars: "", sort: "net_desc" };
const PAGE_SIZE = 50;

const IconCheck = (
	<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
		<path d="m3 8 3 3 7-7" />
	</svg>
);
const IconSort = (
	<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
		<path d="M4 3v10M2 11l2 2 2-2M12 13V3M10 5l2-2 2 2" />
	</svg>
);

/** Toolbar select options. Match the visual idiom of `EvaluateSettings`
 *  (FilterPill with label + dropdown) so the tabs feel like one product. */
const RATING_OPTIONS = [
	{ value: "" as const, label: "All ratings" },
	{ value: "buy" as const, label: "Buy only" },
	{ value: "skip" as const, label: "Skip only" },
];
const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
	{ value: "net_desc", label: "Best E[net] first" },
	{ value: "net_asc", label: "Worst E[net] first" },
	{ value: "recent", label: "Most recent" },
];

export function PlaygroundDeals<TabId extends string = "deals">({
	tabsProps,
}: {
	tabsProps: {
		tabs: ReadonlyArray<ComposeTab<TabId>>;
		active: TabId;
		onChange: (next: TabId) => void;
	};
}) {
	const [query, setQuery] = useState<DealsQuery>(EMPTY);
	const [committedQuery, setCommittedQuery] = useState<DealsQuery>(EMPTY);
	const [page, setPage] = useState(0);
	const [rows, setRows] = useState<AdminEvaluationRow[]>([]);
	const [total, setTotal] = useState(0);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Drawer state. Hold the row we clicked (used to synthesise an
	// ItemSummary for RowDrawer) plus a pending flag while we fetch the
	// full result and seed the eval store.
	const [drawerRow, setDrawerRow] = useState<AdminEvaluationRow | null>(null);
	const [openingId, setOpeningId] = useState<string | null>(null);

	async function openDrawer(row: AdminEvaluationRow) {
		// Seed first, then surface the drawer — RowDrawer reads `useEvalState`
		// on mount; if we open before the seed, it'd briefly render the
		// "Run Evaluate" button before the store flips to complete.
		setOpeningId(row.jobId);
		try {
			const full = await apiFetch<EvaluateResponse>(
				`/v1/admin/evaluations/${encodeURIComponent(row.jobId)}`,
			);
			seedEvalForItem(row.itemId, toEvaluateOutcome(full));
			setDrawerRow(row);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : String(err));
		} finally {
			setOpeningId(null);
		}
	}

	// Debounce text-input commits so each keystroke doesn't re-hit the
	// server. Selects (rating / sort) commit immediately because the
	// keystrokes-per-second concern doesn't apply.
	useEffect(() => {
		const t = setTimeout(() => setCommittedQuery(query), 300);
		return () => clearTimeout(t);
	}, [query]);

	useEffect(() => {
		setPage(0);
	}, [committedQuery]);

	useEffect(() => {
		const ac = new AbortController();
		setPending(true);
		setError(null);
		(async () => {
			try {
				const params = new URLSearchParams();
				if (committedQuery.q.trim()) params.set("q", committedQuery.q.trim());
				if (committedQuery.rating) params.set("rating", committedQuery.rating);
				const minNet = Number.parseInt(committedQuery.minNetDollars, 10);
				if (Number.isFinite(minNet) && minNet > 0) {
					params.set("minNetCents", String(minNet * 100));
				}
				params.set("sort", committedQuery.sort);
				params.set("limit", String(PAGE_SIZE));
				params.set("offset", String(page * PAGE_SIZE));
				const res = await apiFetch<AdminEvaluationList>(
					`/v1/admin/evaluations?${params.toString()}`,
					{ signal: ac.signal },
				);
				setRows(res.rows);
				setTotal(res.total);
			} catch (err) {
				if ((err as { name?: string }).name === "AbortError") return;
				setError(err instanceof Error ? err.message : String(err));
				setRows([]);
				setTotal(0);
			} finally {
				setPending(false);
			}
		})();
		return () => ac.abort();
	}, [committedQuery, page]);

	const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

	return (
		<>
			<ComposeCard width="wide">
				<ComposeTabs tabs={tabsProps.tabs} active={tabsProps.active} onChange={tabsProps.onChange} />

				<ComposeFilters>
					<input
						type="search"
						className="pg-deals-search"
						placeholder="Search title…"
						value={query.q}
						onChange={(e) => setQuery((q) => ({ ...q, q: e.target.value }))}
					/>
					<FilterPill
						label="Rating"
						value={query.rating}
						defaultValue=""
						options={RATING_OPTIONS}
						onChange={(v) => setQuery((q) => ({ ...q, rating: v }))}
						icon={IconCheck}
					/>
					<label className="pg-deals-num-field">
						<span>Min net $</span>
						<input
							type="number"
							inputMode="numeric"
							min={0}
							step={1}
							placeholder="0"
							value={query.minNetDollars}
							onChange={(e) =>
								setQuery((q) => ({ ...q, minNetDollars: e.target.value.replace(/[^\d]/g, "") }))
							}
						/>
					</label>
					<FilterPill
						label="Sort"
						value={query.sort}
						defaultValue="net_desc"
						options={SORT_OPTIONS}
						onChange={(v) => setQuery((q) => ({ ...q, sort: v }))}
						icon={IconSort}
					/>
					<span className="pg-deals-count">
						{pending && rows.length === 0
							? "Loading…"
							: `${total.toLocaleString()} ${total === 1 ? "deal" : "deals"}`}
					</span>
				</ComposeFilters>

				<ComposeOutput minHeight="min-h-[200px]">
					{error ? (
						<p className="pg-deals-error">{error}</p>
					) : pending && rows.length === 0 ? (
						<DealsSkeletonTable />
					) : rows.length === 0 ? (
						<p className="pg-deals-empty">No evaluations match these filters yet.</p>
					) : (
						<DealsTable rows={rows} onSelect={openDrawer} openingId={openingId} />
					)}

					{total > PAGE_SIZE && (
						<div className="pg-deals-pager">
							<button
								type="button"
								className="pg-deals-pager-btn"
								disabled={page === 0 || pending}
								onClick={() => setPage((p) => Math.max(0, p - 1))}
							>
								← Prev
							</button>
							<span className="pg-deals-pager-info">
								Page {page + 1} of {lastPage + 1}
							</span>
							<button
								type="button"
								className="pg-deals-pager-btn"
								disabled={page >= lastPage || pending}
								onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
							>
								Next →
							</button>
						</div>
					)}
				</ComposeOutput>
			</ComposeCard>

			{drawerRow && (
				<RowDrawer item={rowToItemSummary(drawerRow)} onClose={() => setDrawerRow(null)} />
			)}
		</>
	);
}

function DealsTable({
	rows,
	onSelect,
	openingId,
}: {
	rows: AdminEvaluationRow[];
	onSelect: (row: AdminEvaluationRow) => void;
	openingId: string | null;
}) {
	return (
		<div className="pg-deals-table-wrap">
			<div className="pg-deals-table">
				<div className="pg-deals-row pg-deals-row--head" role="row">
					<span />
					<span>Item</span>
					<span className="pg-deals-num">Asking</span>
					<span className="pg-deals-num">Median</span>
					<span className="pg-deals-num">E[net]</span>
					<span>Rating</span>
					<span>Risk</span>
					<span className="pg-deals-num">Days</span>
					<span />
				</div>
				{rows.map((r) => (
					<DealsRow
						key={r.jobId}
						row={r}
						opening={openingId === r.jobId}
						onSelect={() => onSelect(r)}
					/>
				))}
			</div>
		</div>
	);
}

function DealsRow({
	row,
	opening,
	onSelect,
}: {
	row: AdminEvaluationRow;
	opening: boolean;
	onSelect: () => void;
}) {
	const netClass =
		row.expectedNetCents > 0 ? "pg-deals-net pg-deals-net--pos" : "pg-deals-net pg-deals-net--neg";
	function activate() {
		if (!opening) onSelect();
	}
	return (
		<div
			className={`pg-deals-row${opening ? " pg-deals-row--opening" : ""}`}
			role="button"
			tabIndex={0}
			aria-busy={opening || undefined}
			onClick={activate}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					activate();
				}
			}}
		>
			<div className="pg-deals-thumb">
				{row.image ? <img src={row.image} alt="" loading="lazy" /> : <span aria-hidden="true">·</span>}
			</div>
			<div className="pg-deals-title-cell">
				<span className="pg-deals-title" title={row.title}>{row.title}</span>
				<div className="pg-deals-meta">
					{row.condition && <span>{row.condition}</span>}
					{row.categoryName && <span>{row.categoryName}</span>}
					<span title={`Evaluated ${row.completedAt}`}>{relativeFromIso(row.completedAt)}</span>
				</div>
			</div>
			<span className="pg-deals-num">{row.askingPriceCents != null ? formatDollars(row.askingPriceCents) : "—"}</span>
			<span className="pg-deals-num">{formatDollars(row.medianSoldCents)}</span>
			<span className={`pg-deals-num ${netClass}`} title={netTooltip(row)}>
				{formatDollarsSigned(row.expectedNetCents)}
			</span>
			<span>
				<RatingPill rating={row.rating} />
			</span>
			<span>
				<RiskPill
					pFraud={row.pFraud}
					feedbackScore={row.sellerFeedbackScore}
					feedbackPercent={row.sellerFeedbackPercent}
				/>
			</span>
			<span className="pg-deals-num">
				{row.expectedDaysToSell != null ? `${formatDays(row.expectedDaysToSell)}d` : "—"}
			</span>
			<a
				href={row.itemWebUrl}
				target="_blank"
				rel="noopener noreferrer"
				className="pg-deals-link"
				title="Open on eBay"
				aria-label="Open on eBay"
				onClick={(e) => e.stopPropagation()}
			>
				<svg
					width="11"
					height="11"
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
		</div>
	);
}

function RatingPill({ rating }: { rating: Rating }) {
	return <span className={`pg-deals-rating pg-deals-rating--${rating}`}>{rating}</span>;
}

/** Risk tier derived from `P_fraud` (Beta-Bernoulli posterior on seller
 *  feedback). Buckets line up with `risk.ts` anchors:
 *    - low      < 2%   (≥100 fb at ≥99% positive, or no-data prior)
 *    - med      2–5%   (10–100 fb at ~99%)
 *    - high     5–12%  (small samples or 95% sellers)
 *    - severe   ≥12%   (90%-positive at any volume — usually a skip).
 *  Tooltip carries the raw count + percent so the operator can sanity-
 *  check the derived tier without opening the listing. */
function RiskPill({
	pFraud,
	feedbackScore,
	feedbackPercent,
}: {
	pFraud: number | null;
	feedbackScore: number | null;
	feedbackPercent: number | null;
}) {
	if (pFraud == null) {
		return <span className="pg-deals-risk pg-deals-risk--unknown" title="No risk data">—</span>;
	}
	const tier =
		pFraud < 0.02 ? "low" : pFraud < 0.05 ? "med" : pFraud < 0.12 ? "high" : "severe";
	const label =
		tier === "low" ? "low" : tier === "med" ? "med" : tier === "high" ? "high" : "severe";
	const fbBits: string[] = [];
	if (feedbackScore != null) fbBits.push(`${feedbackScore.toLocaleString("en-US")} fb`);
	if (feedbackPercent != null) fbBits.push(`${feedbackPercent.toFixed(1)}%`);
	const tooltip = `${(pFraud * 100).toFixed(1)}% fraud${fbBits.length ? ` · ${fbBits.join(" · ")}` : ""}`;
	return (
		<span className={`pg-deals-risk pg-deals-risk--${tier}`} title={tooltip}>
			{label}
		</span>
	);
}

function DealsSkeletonTable() {
	return (
		<div className="pg-deals-table-wrap">
			<div className="pg-deals-table">
				{Array.from({ length: 6 }).map((_, i) => (
					<div key={`skel-${i}`} className="pg-deals-row pg-deals-row--skel">
						<div className="pg-deals-thumb" />
						<div className="pg-deals-title-cell">
							<span className="pg-deals-skel pg-deals-skel--w-64" />
							<span className="pg-deals-skel pg-deals-skel--w-32" />
						</div>
						<span className="pg-deals-skel pg-deals-skel--w-12" />
						<span className="pg-deals-skel pg-deals-skel--w-12" />
						<span className="pg-deals-skel pg-deals-skel--w-12" />
						<span className="pg-deals-skel pg-deals-skel--w-10" />
						<span className="pg-deals-skel pg-deals-skel--w-10" />
						<span className="pg-deals-skel pg-deals-skel--w-8" />
						<span />
					</div>
				))}
			</div>
		</div>
	);
}

/* ───────── formatters ───────── */

function formatDollars(cents: number): string {
	return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
function formatDollarsSigned(cents: number): string {
	const sign = cents > 0 ? "+" : cents < 0 ? "−" : "";
	const abs = Math.abs(cents) / 100;
	return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
function formatDays(d: number): string {
	if (d < 1) return d.toFixed(1);
	if (d < 10) return d.toFixed(1);
	return Math.round(d).toString();
}
function relativeFromIso(iso: string): string {
	const ms = Date.now() - new Date(iso).getTime();
	const min = Math.round(ms / 60_000);
	if (min < 60) return `${Math.max(0, min)}m ago`;
	const hr = Math.round(min / 60);
	if (hr < 24) return `${hr}h ago`;
	const d = Math.round(hr / 24);
	if (d < 30) return `${d}d ago`;
	const mo = Math.round(d / 30);
	return `${mo}mo ago`;
}
function netTooltip(r: AdminEvaluationRow): string {
	const parts: string[] = [`E[net] ${formatDollarsSigned(r.expectedNetCents)}`];
	if (r.successNetCents != null) parts.push(`success ${formatDollarsSigned(r.successNetCents)}`);
	if (r.maxLossCents != null) parts.push(`max loss ${formatDollars(Math.abs(r.maxLossCents))}`);
	return parts.join(" · ");
}

/* ───────── adapters ─────────
 * The drawer + eval store speak `ItemSummary` / `EvaluateOutcome` (the
 * playground's local shapes). Deals rows carry a slim subset; we
 * reconstruct the parts the drawer reads on first paint, then the
 * full result lands when the seed completes and `useEvalState` flips
 * the drawer into "complete" mode. */

function rowToItemSummary(row: AdminEvaluationRow): ItemSummary {
	return {
		itemId: row.itemId,
		title: row.title,
		itemWebUrl: row.itemWebUrl,
		...(row.condition ? { condition: row.condition } : {}),
		...(row.image ? { image: { imageUrl: row.image } } : {}),
		...(row.askingPriceCents != null
			? { price: { value: (row.askingPriceCents / 100).toFixed(2), currency: "USD" } }
			: {}),
	};
}

/** Wrap a server-side `EvaluateResponse` in the local `EvaluateOutcome`
 *  shape the eval store / drawer expect. The store ignores fields it
 *  doesn't read; we only need to flip `preliminary` and pass through
 *  the response — the typing convergence is handled by the cast. */
function toEvaluateOutcome(res: EvaluateResponse): EvaluateOutcome {
	return { ...(res as unknown as EvaluateOutcome), preliminary: false };
}
