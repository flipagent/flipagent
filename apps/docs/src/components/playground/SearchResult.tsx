/**
 * Search result — flat list of items returned by `/v1/search`. Active
 * mode renders `itemSummaries[]` and supports pagination; sold mode
 * renders `itemSales[]` (Marketplace Insights doesn't paginate).
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
import { CopyTitleButton, cleanItemUrl, Skel } from "./EvaluateResult";
import { Trace } from "./Trace";
import type { BrowseSearchResponse, ItemSummary, Step } from "./types";

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
}: {
	outcome: SearchOutcome;
	steps: Step[];
	pending: boolean;
	/** Pagination handler — fires on Prev/Next click. */
	onPage?: (nextOffset: number) => void;
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
	const source = (outcome.body as { source?: string } | undefined)?.source;
	const showSkeleton = pending && items.length === 0;
	const skelCount = Math.min(outcome.limit, 8);

	return (
		<div className="pg-result-search">
			<header className="pg-result-search-head">
				<span className="pg-result-search-mode">{outcome.mode === "sold" ? "Sold" : "Active"}</span>
				<span className="pg-result-search-count">
					{showSkeleton ? (
						<Skel w={140} h={11} />
					) : items.length === 0 ? (
						"No results"
					) : (
						formatRange(respOffset, items.length, total)
					)}
				</span>
				{source && <span className="pg-result-search-source dash-mono">{source}</span>}
			</header>

			{showSkeleton ? (
				<div className="pg-result-matches">
					{Array.from({ length: skelCount }).map((_, i) => (
						<SkeletonRow key={`skel-${i}`} />
					))}
				</div>
			) : items.length > 0 ? (
				<div className="pg-result-matches">
					{items.map((item) => (
						<SearchRow key={item.itemId} item={item} mode={outcome.mode} />
					))}
				</div>
			) : !pending && outcome.body ? (
				<p className="pg-result-search-empty">Try a broader keyword or different filters.</p>
			) : null}

			{!showSkeleton && items.length > 0 && onPage && (
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

function SearchRow({ item, mode }: { item: ItemSummary; mode: "active" | "sold" }) {
	const priceText = item.lastSoldPrice?.value ?? item.price?.value;
	const isAuction = item.buyingOptions?.includes("AUCTION") ?? false;
	const acceptsOffer = item.buyingOptions?.includes("BEST_OFFER") ?? false;
	const currentBid = item.currentBidPrice?.value;
	let modeTag: string | null = null;
	if (mode === "active") {
		if (isAuction) modeTag = currentBid ? `Auction · $${currentBid} bid` : "Auction · no bids";
		else if (acceptsOffer) modeTag = "Best Offer";
	}
	return (
		<div className="pg-result-matches-row">
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
					{priceText && <span className="font-mono">${priceText}</span>}
					{modeTag && <span className="pg-result-matches-tag">{modeTag}</span>}
				</div>
			</div>
			<a
				href={cleanItemUrl(item.itemWebUrl)}
				target="_blank"
				rel="noopener noreferrer"
				className="pg-result-matches-link"
				title="Open on eBay"
				aria-label="Open on eBay"
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
	return (
		<div className="pg-result-search-pager">
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
