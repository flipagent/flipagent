/**
 * Search result — flat list of items returned by `/v1/items/search`.
 * Active mode renders `itemSummaries[]` and supports pagination; sold
 * mode renders `itemSales[]` (Marketplace Insights doesn't paginate).
 *
 * Reuses the `pg-result-matches-row` CSS scaffold from EvaluateResult
 * so the row anatomy (thumb / title + copy button / meta / external
 * link) stays consistent — and the existing
 * `.pg-result-matches-row:hover .pg-copy-title { opacity: 1 }` rule
 * gives us hover-to-reveal copy for free. While in flight we render
 * `limit` skeleton rows in the same shape so the result panel doesn't
 * shift when items land.
 */

import { useState } from "react";
import { AuthenticityGuaranteeBadge, CopyTitleButton, cleanItemUrl, Skel } from "./EvaluateResult";
import { cancelEvalForItem, runEvalForItem, useEvalState } from "./evalStore";
import { Trace } from "./Trace";
import type { BrowseSearchResponse, ItemSummary, Seller, ShippingOption, Step } from "./types";

export interface SearchOutcome {
	mode: "active" | "sold";
	body?: BrowseSearchResponse;
	/** What the panel asked for. Drives skeleton-row count + the pagination range. */
	limit: number;
	offset: number;
}

export function SearchResult({
	outcome,
	steps,
	pending,
	onPage,
	onSelectItem,
	onEvalItem,
	selectedItemId,
	mockMode = false,
}: {
	outcome: SearchOutcome;
	steps: Step[];
	pending: boolean;
	/** Pagination handler — fires on Prev/Next click. */
	onPage?: (nextOffset: number) => void;
	/**
	 * Row activation. PlaygroundSearch / Sourcing wire this to slide a
	 * detail drawer in on the right (`<RowDrawer>`); the agent inline
	 * panel wires it to dispatch an `embed-tool` for the next chat
	 * turn. Omit and rows just link out to eBay.
	 */
	onSelectItem?: (item: ItemSummary) => void;
	/**
	 * Per-row "Evaluate" button click. When provided, the button bypasses
	 * the local eval store entirely and hands off to the parent — used
	 * by hosts that route evaluation through their own pipeline (e.g.
	 * the agent inline panel forwards back to the next chat turn).
	 * Omit and the button keeps its standalone behavior: idle → run via
	 * `runEvalForItem` against the local store, complete → open drawer,
	 * running → cancel.
	 */
	onEvalItem?: (item: ItemSummary) => void;
	selectedItemId?: string | null;
	/** When true, per-row Run Evaluate uses the canned mockData fixtures
	 *  instead of hitting the live API — same flag the drawer's mockMode
	 *  uses for the logged-out hero. Only consulted when `onEvalItem` is
	 *  not provided (parent override always wins). */
	mockMode?: boolean;
}) {
	const items: ItemSummary[] = outcome.body
		? outcome.mode === "sold"
			? outcome.body.itemSales ?? []
			: outcome.body.itemSummaries ?? []
		: [];
	// eBay returns the offset/limit it actually applied; trust those over
	// our request when present (handles the case where a server-side
	// clamp lowered the values).
	const respLimit = outcome.body?.limit ?? outcome.limit;
	const respOffset = outcome.body?.offset ?? outcome.offset;
	const total = outcome.body?.total;
	const showSkeleton = pending && items.length === 0;
	const skelCount = Math.min(outcome.limit, 8);

	return (
		<div className="pg-result-search">
			{showSkeleton ? (
				<div className="pg-result-matches">
					{Array.from({ length: skelCount }).map((_, i) => (
						<SkeletonRow key={`skel-${i}`} />
					))}
				</div>
			) : items.length > 0 ? (
				<div className="pg-result-matches">
					{items.map((item) => (
						<SearchRow
							key={item.itemId}
							item={item}
							mode={outcome.mode}
							onSelect={onSelectItem}
							onEval={onEvalItem}
							selected={selectedItemId === item.itemId}
							mockMode={mockMode}
						/>
					))}
				</div>
			) : !pending && outcome.body ? (
				<p className="pg-result-search-empty">Try a broader keyword or different filters.</p>
			) : null}

			{onPage && (
				<Pager
					offset={respOffset}
					limit={respLimit}
					returned={items.length}
					total={total}
					pending={pending}
					onPage={onPage}
				/>
			)}

			<TraceExpander steps={steps} pending={pending} />
		</div>
	);
}

/**
 * Compact "Showing 1–25 of 2.4K" header. eBay's `total` is the entire
 * marketplace match count (often huge) — formatting it short keeps the
 * eyebrow legible without lying about precision.
 */
function formatRange(offset: number, returned: number, total: number | undefined): string {
	const lo = offset + 1;
	const hi = offset + returned;
	if (total == null) return `${returned} ${returned === 1 ? "result" : "results"}`;
	return `Showing ${lo.toLocaleString()}–${hi.toLocaleString()} of ${formatCompactCount(total)}`;
}

const COMPACT_COUNT = new Intl.NumberFormat("en", {
	notation: "compact",
	maximumFractionDigits: 1,
}) as Intl.NumberFormat;

function formatCompactCount(n: number): string {
	if (n < 1000) return String(n);
	return COMPACT_COUNT.format(n);
}

/**
 * `+$8 ship` for paid shipping; `free ship` when zero. Returned as a
 * trailing fragment so the price + shipping read as one landed-cost
 * line (`$42 + $8 ship`) instead of two disjoint chips. `null` when no
 * shipping data — the row falls back to bare price, which is honest
 * about the gap rather than implying "free".
 */
export function formatShipping(opt: ShippingOption | undefined): string | null {
	if (!opt) return null;
	const v = opt.shippingCost?.value;
	if (v == null) return null;
	const num = Number(v);
	if (!Number.isFinite(num)) return null;
	if (num === 0) return "free ship";
	return `+$${v} ship`;
}

/**
 * Auction heat — bid count is the load-bearing number once bidding is
 * live. When no bids have landed yet but the listing has watchers, fall
 * back to "{n} watching" — a hot pre-bid auction reads correctly that
 * way. Otherwise "no bids" so the row distinguishes "no activity yet"
 * from "no auction format at all".
 */
export function formatAuctionStat(item: ItemSummary): string {
	const bids = item.bidCount ?? 0;
	if (bids > 0) return `${bids} bid${bids === 1 ? "" : "s"}`;
	if (item.watchCount && item.watchCount > 0) return `${formatCompactCount(item.watchCount)} watching`;
	return "no bids";
}

/**
 * Compact seller signal for the row — feedback % with total count in
 * parens. `level` mirrors `sellerMetaText` in EvaluateResult so the
 * row, drawer, and Evaluate matches list agree on what's a flag:
 *   warn (red): zero feedback — burner / banned-and-relisted shape.
 *   caution (orange): thin (<10) or sub-95% positive — model trusts less.
 */
export function sellerChip(seller: Seller | undefined): { text: string; level: "ok" | "caution" | "warn" } | null {
	if (!seller) return null;
	const pctStr = seller.feedbackPercentage;
	const score = seller.feedbackScore ?? null;
	if (!pctStr && score == null) return null;
	const pct = pctStr ? Number.parseFloat(pctStr) : null;
	let level: "ok" | "caution" | "warn" = "ok";
	if (score === 0) level = "warn";
	else if ((score != null && score < 10) || (pct != null && pct < 95)) level = "caution";
	let text: string;
	if (pctStr) {
		const trimmed = pctStr.includes(".") ? pctStr.replace(/\.?0+$/, "") : pctStr;
		text = score != null ? `${trimmed}% (${formatCompactCount(score)})` : `${trimmed}%`;
	} else {
		text = `${formatCompactCount(score ?? 0)} sales`;
	}
	return { text, level };
}

/**
 * "ships from CN" when the listing's origin country is something the
 * buyer should know about. Suppress the US case — the playground is
 * US-default and a "ships from US" chip on every domestic row is just
 * noise. TODO: pass the active marketplace once the playground is
 * non-US-aware so this filter follows the user.
 */
export function formatShipsFrom(loc: ItemSummary["itemLocation"]): string | null {
	const c = loc?.country;
	if (!c || c === "US") return null;
	return `ships from ${c}`;
}

function formatEndsIn(iso: string | undefined): string | null {
	if (!iso) return null;
	const end = Date.parse(iso);
	if (!Number.isFinite(end)) return null;
	const ms = end - Date.now();
	if (ms <= 0) return "ended";
	const sec = Math.floor(ms / 1000);
	const days = Math.floor(sec / 86400);
	const hours = Math.floor((sec % 86400) / 3600);
	const mins = Math.floor((sec % 3600) / 60);
	if (days >= 1) return `ends in ${days}d ${hours}h`;
	if (hours >= 1) return `ends in ${hours}h ${mins}m`;
	if (mins >= 1) return `ends in ${mins}m`;
	return "ends <1m";
}

function SkeletonRow() {
	return (
		<div className="pg-result-matches-row pg-result-matches-row--skel">
			<div className="pg-result-matches-thumb">
				<Skel w={36} h={36} />
			</div>
			<div className="pg-result-matches-body">
				<div className="pg-result-matches-title-row">
					<Skel w={260} h={12} />
				</div>
				<div className="pg-result-matches-meta">
					<Skel w={50} h={10} />
					<Skel w={70} h={10} />
				</div>
			</div>
			<span className="pg-result-matches-link" aria-hidden="true">
				<Skel w={14} h={14} />
			</span>
		</div>
	);
}

/** Reusable idle-state literal for the parent-owned eval path so we
 *  don't allocate a new object each render. */
const IDLE_STATE = { status: "idle" } as const;

function SearchRow({
	item,
	mode,
	onSelect,
	onEval,
	selected,
	mockMode,
}: {
	item: ItemSummary;
	mode: "active" | "sold";
	onSelect?: (item: ItemSummary) => void;
	onEval?: (item: ItemSummary) => void;
	selected?: boolean;
	mockMode: boolean;
}) {
	const priceText = item.lastSoldPrice?.value ?? item.price?.value;
	const isAuction = item.buyingOptions?.includes("AUCTION") ?? false;
	const acceptsOffer = item.buyingOptions?.includes("BEST_OFFER") ?? false;
	// Line 1 enrichments — landed-cost shipping, auction heat (bids /
	// watchers fallback / "no bids"), Best Offer pill for FP listings,
	// auction countdown.
	const shipText = formatShipping(item.shippingOptions?.[0]);
	const auctionStat = mode === "active" && isAuction ? formatAuctionStat(item) : null;
	const offerTag = mode === "active" && !isAuction && acceptsOffer ? "Best Offer" : null;
	const endsTag = mode === "active" && isAuction ? formatEndsIn(item.itemEndDate) : null;
	// Line 2 trust strip — only renders when at least one signal is present.
	const showAg = item.authenticityGuarantee === true;
	const showTrs = item.topRatedBuyingExperience === true;
	const sellerInfo = sellerChip(item.seller);
	const shipsFromText = formatShipsFrom(item.itemLocation);
	const showTrustLine = showAg || showTrs || sellerInfo !== null || shipsFromText !== null;

	// Shared per-itemId eval state — flipping in the store also updates
	// the RowDrawer when it's open for this item, so running progress and
	// completion stay in sync between the inline button and the full
	// drawer view.
	const evalState = useEvalState(item.itemId);

	function onEvalClick(e: React.MouseEvent) {
		e.stopPropagation();
		// Parent override — host owns evaluation (e.g. agent inline panel
		// forwards back to the next chat turn). Skip the local eval store
		// entirely so we don't double-run / mis-redirect.
		if (onEval) {
			onEval(item);
			return;
		}
		if (evalState.status === "running") {
			cancelEvalForItem(item.itemId);
		} else if (evalState.status === "complete") {
			// Already done — open the drawer to view full result.
			onSelect?.(item);
		} else {
			runEvalForItem(item.itemId, mockMode);
		}
	}

	return (
		<div className="pg-result-matches-row"
			data-selectable={onSelect ? "true" : undefined}
			data-selected={selected ? "true" : undefined}
			onClick={onSelect ? () => onSelect(item) : undefined}
			role={onSelect ? "button" : undefined}
			tabIndex={onSelect ? 0 : undefined}
			onKeyDown={
				onSelect
					? (e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								onSelect(item);
							}
						}
					: undefined
			}
		>
			<div className="pg-result-matches-thumb">
				{item.image?.imageUrl ? (
					<img src={item.image.imageUrl} alt="" loading="lazy" />
				) : (
					<span aria-hidden="true">·</span>
				)}
			</div>
			<div className="pg-result-matches-body">
				<div className="pg-result-matches-title-row">
					<span className="pg-result-matches-title">{item.title}</span>
					<CopyTitleButton text={item.title} />
				</div>
				<div className="pg-result-matches-meta">
					{item.condition && <span>{item.condition}</span>}
					{priceText && (
						<span className="font-mono">
							${priceText}
							{shipText && <span className="pg-result-matches-ship"> {shipText}</span>}
						</span>
					)}
					{auctionStat && <span className="pg-result-matches-tag">{auctionStat}</span>}
					{offerTag && <span className="pg-result-matches-tag">{offerTag}</span>}
					{endsTag && <span className="pg-result-matches-tag">{endsTag}</span>}
				</div>
				{showTrustLine && (
					<div className="pg-result-matches-meta pg-result-matches-trust">
						{showAg && <AuthenticityGuaranteeBadge />}
						{showTrs && (
							<span
								className="pg-result-matches-trust-chip pg-result-matches-trust-chip--trs"
								title="Top Rated Seller"
							>
								Top Rated
							</span>
						)}
						{sellerInfo && (
							<span
								className="pg-result-matches-trust-chip"
								data-level={sellerInfo.level}
								title={item.seller?.username ? `Seller ${item.seller.username}` : undefined}
							>
								{sellerInfo.text}
							</span>
						)}
						{shipsFromText && (
							<span
								className="pg-result-matches-trust-chip pg-result-matches-trust-chip--origin"
								title="Item ships from outside the US"
							>
								{shipsFromText}
							</span>
						)}
					</div>
				)}
			</div>
			<div className="pg-search-row-actions">
				{/* When the parent owns eval, force the visual to the idle "Run
				    Evaluate" state — local-store status (running/complete) is
				    meaningless from the parent's perspective. */}
				<EvalButton state={onEval ? IDLE_STATE : evalState} onClick={onEvalClick} />
				<a
					href={cleanItemUrl(item.itemWebUrl)}
					target="_blank"
					rel="noopener noreferrer"
					className="pg-result-matches-link"
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
		</div>
	);
}

/**
 * Single button that morphs through the eval lifecycle: idle → Eval,
 * running → Cancel (with spinner), complete → View, error → Retry.
 * The Cancel state's spinner is the only inline running indicator —
 * everything else lives in the drawer.
 */
function EvalButton({
	state,
	onClick,
}: {
	state: ReturnType<typeof useEvalState>;
	onClick: (e: React.MouseEvent) => void;
}) {
	if (state.status === "running") {
		return (
			<button
				type="button"
				className="pg-search-row-eval-btn pg-search-row-eval-btn--cancel"
				onClick={onClick}
				title="Cancel"
				aria-label="Cancel"
			>
				<svg className="pg-search-row-eval-spin" width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
					<path d="M8 1.5a6.5 6.5 0 1 0 6.5 6.5" />
				</svg>
				Cancel
			</button>
		);
	}
	if (state.status === "complete") {
		return (
			<button
				type="button"
				className="pg-search-row-eval-btn pg-search-row-eval-btn--view"
				onClick={onClick}
				title="View result"
				aria-label="View result"
			>
				<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
					<path d="M2 8s2.5-4.5 6-4.5S14 8 14 8s-2.5 4.5-6 4.5S2 8 2 8z" />
					<circle cx="8" cy="8" r="1.6" />
				</svg>
				View
			</button>
		);
	}
	if (state.status === "error") {
		return (
			<button
				type="button"
				className="pg-search-row-eval-btn"
				onClick={onClick}
				title="Retry"
				aria-label="Retry"
			>
				<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
					<path d="M14 4v4h-4" />
					<path d="M14 8a6 6 0 1 1-1.6-4.1" />
				</svg>
				Retry
			</button>
		);
	}
	return (
		<button
			type="button"
			className="pg-search-row-eval-btn"
			onClick={onClick}
			title="Run Evaluate"
			aria-label="Run Evaluate"
		>
			<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
				<path d="M3 11a5 5 0 0 1 10 0" />
				<path d="M8 11l2.5-2.5" />
				<circle cx="8" cy="11" r="0.6" fill="currentColor" />
			</svg>
			Evaluate
		</button>
	);
}

/**
 * Active-mode pager. eBay caps practical pagination at offset+limit ≤
 * 10000, so once we hit that ceiling Next disables. When `total` is
 * reported and smaller than the cap, we use that as the upper bound
 * instead.
 */
const EBAY_PAGE_CAP = 10000;

function Pager({
	offset,
	limit,
	returned,
	total,
	pending,
	onPage,
}: {
	offset: number;
	limit: number;
	returned: number;
	total: number | undefined;
	pending: boolean;
	onPage: (nextOffset: number) => void;
}) {
	const ceiling = Math.min(total ?? Number.POSITIVE_INFINITY, EBAY_PAGE_CAP);
	const hasPrev = offset > 0;
	const hasNext = !pending && returned >= limit && offset + limit < ceiling;
	const page = Math.floor(offset / limit) + 1;
	const range = returned > 0 ? formatRange(offset, returned, total) : null;
	return (
		<div className="pg-result-search-pager">
			<span className="pg-result-search-pager-side" aria-hidden="true" />
			<div className="pg-result-search-pager-controls">
				<button
					type="button"
					className="pg-result-search-pager-btn"
					onClick={() => onPage(Math.max(0, offset - limit))}
					disabled={!hasPrev || pending}
				>
					<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
						<path d="M10 3 5 8l5 5" />
					</svg>
					Prev
				</button>
				<span className="pg-result-search-pager-meta dash-mono">Page {page}</span>
				<button
					type="button"
					className="pg-result-search-pager-btn"
					onClick={() => onPage(offset + limit)}
					disabled={!hasNext}
				>
					Next
					<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
						<path d="M6 3l5 5-5 5" />
					</svg>
				</button>
			</div>
			<span className="pg-result-search-pager-range dash-mono">{range ?? ""}</span>
		</div>
	);
}

function TraceExpander({ steps, pending }: { steps: Step[]; pending: boolean }) {
	const [open, setOpen] = useState(false);
	if (steps.length === 0) return null;
	// While the call is streaming, show the trace inline (no toggle) so
	// users see each step tick over. Once it lands, tuck behind a
	// "Show trace" affordance — same pattern as EvaluateResult.
	if (pending) {
		return (
			<div className="pg-result-foot pg-result-foot--running">
				<Trace steps={steps} />
			</div>
		);
	}
	return (
		<div className="pg-result-foot">
			<div className="pg-result-foot-row">
				<span />
				<button
					type="button"
					className="pg-result-trace-toggle"
					onClick={() => setOpen((o) => !o)}
					aria-expanded={open}
				>
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
					{open ? "Hide trace" : "Show trace"}
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
