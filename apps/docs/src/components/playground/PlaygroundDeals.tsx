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
 *
 * Columns are user-configurable: a Columns picker on the filter bar
 * toggles which of the (~10) reseller signals show in the table. The
 * choice persists per-browser in localStorage. The visible-column set
 * drives both the head row and each body row's `gridTemplateColumns`,
 * so the layout reflows without hidden width cost.
 */

import * as RxPopover from "@radix-ui/react-popover";
import type { AdminEvaluationList, AdminEvaluationRow, EvaluateResponse } from "@flipagent/types";
import { useEffect, useMemo, useState } from "react";
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
import { Tooltip } from "../ui/Tooltip";
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
const IconColumns = (
	<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
		<rect x="2" y="3" width="3.5" height="10" rx="0.5" />
		<rect x="6.25" y="3" width="3.5" height="10" rx="0.5" />
		<rect x="10.5" y="3" width="3.5" height="10" rx="0.5" />
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

/* ───────── columns ─────────
 * Single source of truth for the table's column registry. Each entry
 * declares the header label, grid width, render function, and the
 * default-visibility flag. Adding/removing/reordering happens here —
 * the table head + body iterate the visible subset. */

type ColumnId =
	| "asking"
	| "median"
	| "n"
	| "expectedNet"
	| "rating"
	| "risk"
	| "days"
	| "salesPerDay"
	| "asks"
	| "successNet"
	| "maxLoss"
	| "dollarsPerDay";

interface ColumnDef {
	id: ColumnId;
	label: string;
	/** Short text shown inside the columns-picker (truncated label fine). */
	pickerLabel: string;
	/** CSS grid width — single track. */
	width: string;
	/** Whether the cell hugs the right edge (numeric / tabular). */
	numeric?: boolean;
	defaultVisible: boolean;
	render: (row: AdminEvaluationRow) => React.ReactNode;
}

const COLUMNS: ReadonlyArray<ColumnDef> = [
	{
		id: "asking",
		label: "Asking",
		pickerLabel: "Asking price",
		width: "70px",
		numeric: true,
		defaultVisible: true,
		render: (r) => (r.askingPriceCents != null ? formatDollars(r.askingPriceCents) : "—"),
	},
	{
		id: "median",
		label: "Median",
		pickerLabel: "Sold median",
		width: "70px",
		numeric: true,
		defaultVisible: true,
		render: (r) => formatDollars(r.medianSoldCents),
	},
	{
		id: "n",
		label: "n",
		pickerLabel: "Sample size (n sold)",
		width: "32px",
		numeric: true,
		defaultVisible: true,
		render: (r) => (
			// Reseller's reliability check: n=1 is noise, n=30+ is signal.
			// Tooltip spells it out so the column header (just "n") doesn't
			// need to explain itself in-table.
			<Tooltip content={`${r.nSold} sold comparables (post-IQR filter)`}>
				<span>{r.nSold}</span>
			</Tooltip>
		),
	},
	{
		id: "expectedNet",
		label: "E[net]",
		pickerLabel: "Expected net",
		width: "90px",
		numeric: true,
		defaultVisible: true,
		render: (r) => {
			const cls =
				r.expectedNetCents > 0 ? "pg-deals-net pg-deals-net--pos" : "pg-deals-net pg-deals-net--neg";
			return (
				<Tooltip content={netTooltip(r)}>
					<span className={cls}>{formatDollarsSigned(r.expectedNetCents)}</span>
				</Tooltip>
			);
		},
	},
	{
		id: "rating",
		label: "Rating",
		pickerLabel: "Rating verdict",
		width: "56px",
		defaultVisible: true,
		render: (r) => <RatingPill rating={r.rating} />,
	},
	{
		id: "risk",
		label: "Seller risk",
		pickerLabel: "Seller risk",
		width: "108px",
		defaultVisible: true,
		render: (r) => (
			<RiskPill
				pFraud={r.pFraud}
				feedbackScore={r.sellerFeedbackScore}
				feedbackPercent={r.sellerFeedbackPercent}
			/>
		),
	},
	{
		id: "days",
		label: "Days",
		pickerLabel: "Expected days to sell",
		width: "56px",
		numeric: true,
		defaultVisible: true,
		render: (r) => (r.expectedDaysToSell != null ? `${formatDays(r.expectedDaysToSell)}d` : "—"),
	},
	{
		id: "salesPerDay",
		label: "Sold/day",
		pickerLabel: "Market velocity (sales/day)",
		width: "64px",
		numeric: true,
		defaultVisible: true,
		render: (r) => (
			// Liquidity at the market level. Different question than `Days`
			// (which factors in queue position) — Sold/day tells you whether
			// the *category* is hot or dead.
			<Tooltip content={`${r.salesPerDay.toFixed(2)} sales/day across the comp pool`}>
				<span>{formatRate(r.salesPerDay)}</span>
			</Tooltip>
		),
	},
	{
		id: "asks",
		label: "Asks",
		pickerLabel: "Active asks (queue)",
		width: "44px",
		numeric: true,
		defaultVisible: true,
		render: (r) => (
			// How many sellers I'd be lining up behind. Combined with
			// Sold/day this is the resaler-mental "is this category
			// saturated?" gut check.
			<Tooltip content={`${r.nActive} active listings competing for the same buyers`}>
				<span>{r.nActive}</span>
			</Tooltip>
		),
	},
	// Default-hidden columns — useful for deeper inspection but redundant
	// with E[net] / Days / Risk for most scans.
	{
		id: "successNet",
		label: "Success",
		pickerLabel: "Success net (if it sells)",
		width: "70px",
		numeric: true,
		defaultVisible: false,
		render: (r) => (r.successNetCents != null ? formatDollarsSigned(r.successNetCents) : "—"),
	},
	{
		id: "maxLoss",
		label: "Max loss",
		pickerLabel: "Max loss (if fraud)",
		width: "70px",
		numeric: true,
		defaultVisible: false,
		render: (r) => (r.maxLossCents != null ? formatDollars(Math.abs(r.maxLossCents)) : "—"),
	},
	{
		id: "dollarsPerDay",
		label: "$/day",
		pickerLabel: "Capital efficiency ($/day)",
		width: "60px",
		numeric: true,
		defaultVisible: false,
		render: (r) => {
			// derived: E[net] / cycleDays approximation. recommendedExit
			// already publishes this on the full evaluate row, but the
			// admin slim-row only carries E[net] + days; use the same
			// shape so the two views agree.
			if (r.expectedDaysToSell == null || r.expectedDaysToSell <= 0) return "—";
			return formatDollarsSigned(Math.round(r.expectedNetCents / r.expectedDaysToSell));
		},
	},
];

const COLUMN_VIS_STORAGE_KEY = "flipagent.deals.columns.v1";

function loadColumnVisibility(): Set<ColumnId> {
	if (typeof window === "undefined") return defaultColumnVisibility();
	try {
		const raw = window.localStorage.getItem(COLUMN_VIS_STORAGE_KEY);
		if (!raw) return defaultColumnVisibility();
		const arr = JSON.parse(raw) as unknown;
		if (!Array.isArray(arr)) return defaultColumnVisibility();
		const known = new Set(COLUMNS.map((c) => c.id));
		const filtered = arr.filter((id): id is ColumnId => typeof id === "string" && known.has(id as ColumnId));
		return new Set(filtered);
	} catch {
		return defaultColumnVisibility();
	}
}
function defaultColumnVisibility(): Set<ColumnId> {
	return new Set(COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id));
}

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
	const [visibleCols, setVisibleCols] = useState<Set<ColumnId>>(defaultColumnVisibility);
	// Drawer state. Hold the row we clicked (used to synthesise an
	// ItemSummary for RowDrawer) plus a pending flag while we fetch the
	// full result and seed the eval store.
	const [drawerRow, setDrawerRow] = useState<AdminEvaluationRow | null>(null);
	const [openingId, setOpeningId] = useState<string | null>(null);

	// Hydrate visibility from localStorage on first paint (client-only).
	useEffect(() => {
		setVisibleCols(loadColumnVisibility());
	}, []);
	useEffect(() => {
		if (typeof window === "undefined") return;
		try {
			window.localStorage.setItem(COLUMN_VIS_STORAGE_KEY, JSON.stringify([...visibleCols]));
		} catch {
			// ignore quota / private mode
		}
	}, [visibleCols]);

	const orderedVisible = useMemo(
		() => COLUMNS.filter((c) => visibleCols.has(c.id)),
		[visibleCols],
	);
	// Grid template: thumb + item (1fr) + each visible data column + link.
	const gridTemplate = useMemo(
		() =>
			["36px", "minmax(0, 1fr)", ...orderedVisible.map((c) => c.width), "28px"].join(" "),
		[orderedVisible],
	);

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
					<ColumnsPicker visible={visibleCols} onChange={setVisibleCols} />
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
						<DealsSkeletonTable gridTemplate={gridTemplate} colCount={orderedVisible.length} />
					) : rows.length === 0 ? (
						<p className="pg-deals-empty">No evaluations match these filters yet.</p>
					) : (
						<DealsTable
							rows={rows}
							columns={orderedVisible}
							gridTemplate={gridTemplate}
							onSelect={openDrawer}
							openingId={openingId}
						/>
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
	columns,
	gridTemplate,
	onSelect,
	openingId,
}: {
	rows: AdminEvaluationRow[];
	columns: ReadonlyArray<ColumnDef>;
	gridTemplate: string;
	onSelect: (row: AdminEvaluationRow) => void;
	openingId: string | null;
}) {
	return (
		<div className="pg-deals-table-wrap">
			<div className="pg-deals-table">
				<div
					className="pg-deals-row pg-deals-row--head"
					role="row"
					style={{ gridTemplateColumns: gridTemplate }}
				>
					<span />
					<span>Item</span>
					{columns.map((c) => (
						<span key={c.id} className={c.numeric ? "pg-deals-num" : ""}>
							{c.label}
						</span>
					))}
					<span />
				</div>
				{rows.map((r) => (
					<DealsRow
						key={r.jobId}
						row={r}
						columns={columns}
						gridTemplate={gridTemplate}
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
	columns,
	gridTemplate,
	opening,
	onSelect,
}: {
	row: AdminEvaluationRow;
	columns: ReadonlyArray<ColumnDef>;
	gridTemplate: string;
	opening: boolean;
	onSelect: () => void;
}) {
	function activate() {
		if (!opening) onSelect();
	}
	return (
		<div
			className={`pg-deals-row${opening ? " pg-deals-row--opening" : ""}`}
			role="button"
			tabIndex={0}
			aria-busy={opening || undefined}
			style={{ gridTemplateColumns: gridTemplate }}
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
					<Tooltip content={`Evaluated ${row.completedAt}`}>
					<span>{relativeFromIso(row.completedAt)}</span>
				</Tooltip>
				</div>
			</div>
			{columns.map((c) => (
				<span key={c.id} className={c.numeric ? "pg-deals-num" : ""}>
					{c.render(row)}
				</span>
			))}
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
 *  Renders `tier · NNNk fb` inline so the column self-explains: the
 *  operator sees both the verdict (low/med/high/severe) and the raw
 *  signal it's drawn from without hovering a tooltip. */
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
		return (
			<Tooltip content="No seller risk data on file">
				<span className="pg-deals-risk pg-deals-risk--unknown">—</span>
			</Tooltip>
		);
	}
	const tier =
		pFraud < 0.02 ? "low" : pFraud < 0.05 ? "med" : pFraud < 0.12 ? "high" : "severe";
	const fbText = feedbackScore != null ? `${formatCount(feedbackScore)} fb` : "no fb";
	const tooltip = `${(pFraud * 100).toFixed(1)}% fraud risk${
		feedbackPercent != null ? ` · ${feedbackPercent.toFixed(1)}% positive` : ""
	}`;
	return (
		<Tooltip content={tooltip}>
			<span className={`pg-deals-risk pg-deals-risk--${tier}`}>
				<span className="pg-deals-risk-tier">{tier}</span>
				<span className="pg-deals-risk-sep">·</span>
				<span className="pg-deals-risk-fb">{fbText}</span>
			</span>
		</Tooltip>
	);
}

function ColumnsPicker({
	visible,
	onChange,
}: {
	visible: Set<ColumnId>;
	onChange: (next: Set<ColumnId>) => void;
}) {
	const visibleCount = visible.size;
	const totalCount = COLUMNS.length;
	const allDefaults = useMemo(() => COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id), []);
	function toggle(id: ColumnId) {
		const next = new Set(visible);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		onChange(next);
	}
	function reset() {
		onChange(new Set(allDefaults));
	}
	const isDefault =
		visibleCount === allDefaults.length && allDefaults.every((id) => visible.has(id));
	return (
		<RxPopover.Root>
			<RxPopover.Trigger
				className={`flex items-center gap-1.5 h-7 px-2.5 rounded-[6px] text-[12px] border transition-colors duration-100 cursor-pointer outline-none ${
					isDefault
						? "border-[var(--border-faint)] text-[var(--text-3)] hover:text-[var(--text)] hover:border-[var(--border)]"
						: "border-[var(--brand)] text-[var(--brand)] bg-[var(--brand-soft)]"
				} data-[state=open]:border-[var(--text-3)] data-[state=open]:text-[var(--text)]`}
			>
				<span className="flex items-center" aria-hidden="true">
					{IconColumns}
				</span>
				<span>Columns</span>
				{!isDefault && (
					<>
						<span className="opacity-60 mx-1">·</span>
						<span>{visibleCount}/{totalCount}</span>
					</>
				)}
				<svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
					<path d="m3 4 2 2 2-2" />
				</svg>
			</RxPopover.Trigger>
			<RxPopover.Portal>
				<RxPopover.Content
					align="end"
					sideOffset={4}
					collisionPadding={8}
					className="z-50 w-[260px] max-h-[420px] overflow-y-auto bg-[var(--surface)] border border-[var(--border)] rounded-[6px] shadow-[0_8px_28px_rgba(0,0,0,0.10)] p-1"
				>
					<div className="px-3 py-2 flex items-center justify-between border-b border-[var(--border-faint)]">
						<span className="text-[11px] uppercase tracking-wider text-[var(--text-3)]">Visible columns</span>
						<button
							type="button"
							onClick={reset}
							disabled={isDefault}
							className="text-[11px] text-[var(--text-3)] hover:text-[var(--brand)] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
						>
							Reset
						</button>
					</div>
					<ul className="py-1">
						{COLUMNS.map((c) => {
							const checked = visible.has(c.id);
							return (
								<li key={c.id}>
									<label className="flex items-center gap-2 px-3 py-2 text-[12.5px] text-[var(--text)] cursor-pointer hover:bg-[var(--surface-2)] rounded-[4px]">
										<input
											type="checkbox"
											checked={checked}
											onChange={() => toggle(c.id)}
											className="accent-[var(--brand)] cursor-pointer"
										/>
										<span className="flex-1">{c.pickerLabel}</span>
									</label>
								</li>
							);
						})}
					</ul>
				</RxPopover.Content>
			</RxPopover.Portal>
		</RxPopover.Root>
	);
}

function DealsSkeletonTable({
	gridTemplate,
	colCount,
}: {
	gridTemplate: string;
	colCount: number;
}) {
	return (
		<div className="pg-deals-table-wrap">
			<div className="pg-deals-table">
				{Array.from({ length: 6 }).map((_, i) => (
					<div
						key={`skel-${i}`}
						className="pg-deals-row pg-deals-row--skel"
						style={{ gridTemplateColumns: gridTemplate }}
					>
						<div className="pg-deals-thumb" />
						<div className="pg-deals-title-cell">
							<span className="pg-deals-skel pg-deals-skel--w-64" />
							<span className="pg-deals-skel pg-deals-skel--w-32" />
						</div>
						{Array.from({ length: colCount }).map((_, j) => (
							<span key={`skel-${i}-${j}`} className="pg-deals-skel pg-deals-skel--w-10" />
						))}
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
/** Compact rate format: 0.07 → "0.07", 1.2 → "1.2", 12 → "12".
 *
 *  Below 0.005/day the rate would round to "0.00" via `toFixed(2)`, which
 *  is visually indistinguishable from "no data". Substitute `<0.01` to
 *  preserve the "tiny but not zero" signal — these are genuinely-cooling
 *  markets the recency-weighted estimator is honestly flagging, and that
 *  distinction matters when the operator scans for skip-with-conviction
 *  rows. Truly-zero (no observations) keeps the `"0"` rendering. */
function formatRate(rate: number): string {
	if (!Number.isFinite(rate) || rate <= 0) return "0";
	if (rate < 0.005) return "<0.01";
	if (rate < 1) return rate.toFixed(2);
	if (rate < 10) return rate.toFixed(1);
	return Math.round(rate).toString();
}
/** Compact count: 1234 → "1.2k", 27 → "27". Used in seller fb tags. */
function formatCount(n: number): string {
	if (!Number.isFinite(n) || n <= 0) return "0";
	if (n < 1000) return Math.round(n).toString();
	if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	return `${(n / 1_000_000).toFixed(1)}M`;
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
