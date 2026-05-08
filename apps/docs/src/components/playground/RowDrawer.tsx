/**
 * RowDrawer — overlay drawer that slides in from the right edge.
 * Two visual states share one anchor (the title + chip strip):
 *
 *   1. **Item card** — image gallery, title, trust chips (Top Rated /
 *      Authenticity / Returns), price strip with shipping + ships-from,
 *      buyer-decision rows (Condition / Brand / Category / Seller /
 *      Returns / Watching), auction info when relevant, full specs
 *      table. Detail loads in background on open via
 *      `playgroundApi.itemDetail`; rows show skeletons until it lands.
 *      Run Evaluate is the primary CTA.
 *
 *   2. **Evaluate result** — once Run lands, the item card collapses
 *      behind a `Show item details` toggle and `EvaluateResultBody`
 *      renders below with `hideHero` so the market analysis flows
 *      under the same anchor.
 *
 * Self-contained: holds detail-fetch + evaluate-run state. Resets when
 * the host swaps the `item` prop. Backdrop click + ESC dismiss; outer
 * scroll lock while open.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { playgroundApi } from "./api";
import { CopyTitleButton, EvaluateResult, Row, Skel, cleanItemUrl } from "./EvaluateResult";
import {
	cancelEvalForItem,
	resetEvalForItem,
	runEvalForItem,
	useEvalState,
} from "./evalStore";
import { hasMockEvaluateFixture, mockEvaluateFixture } from "./mockData";
import type { ItemDetail, ItemSummary } from "./types";

const SPECS_INITIAL_LIMIT = 8;

export function RowDrawer({
	item,
	onClose,
	mockMode = false,
}: {
	item: ItemSummary;
	onClose: () => void;
	/** When true (logged-out hero), seed detail from canned fixtures and run the
	 *  mock pipeline. Non-fixture rep itemIds redirect to /signup so the demo
	 *  never shows mismatched Evaluate data under a different item title. */
	mockMode?: boolean;
}) {
	const [detail, setDetail] = useState<ItemDetail | null>(null);
	const [detailPending, setDetailPending] = useState(true);
	const [specsOpen, setSpecsOpen] = useState(false);

	const evalState = useEvalState(item.itemId);
	const detailAbortRef = useRef<AbortController | null>(null);

	// Derive the legacy-shape values the rendering code below expects so we
	// don't have to rewrite EvaluateResultBody / EvalFooter every refactor.
	const hasRun = evalState.status === "running" || evalState.status === "complete";
	const pending = evalState.status === "running";
	const outcome =
		evalState.status === "running" || evalState.status === "complete" ? evalState.outcome : {};
	const steps =
		evalState.status === "running" || evalState.status === "complete" ? evalState.steps : [];
	const err = evalState.status === "error" ? { message: evalState.message, upgradeUrl: evalState.upgradeUrl } : null;

	// Reset the per-itemId UI state on item swap. The eval state itself
	// lives in the shared store keyed by itemId, so it's already correct
	// for the new selection — nothing to reset there.
	useEffect(() => {
		detailAbortRef.current?.abort();
		detailAbortRef.current = null;
		setDetail(null);
		setDetailPending(true);
		setSpecsOpen(false);
	}, [item.itemId]);

	useEffect(() => {
		// When an eval is running or already complete, the pipeline's first
		// step (`detail`) populates `evalState.outcome.item` with the same
		// data this standalone fetch would return — same server cache key
		// either way. Skip the duplicate browser→server round-trip and
		// merge `outcome.item` into the rendered card instead.
		if (evalState.status === "running" || evalState.status === "complete") {
			detailAbortRef.current?.abort();
			detailAbortRef.current = null;
			setDetailPending(false);
			return;
		}
		if (mockMode) {
			// Seed detail from the canned fixture when we have one; otherwise
			// the row's summary is enough to render the card. Either way, no
			// network — so no 401 noise in DevTools for the logged-out hero.
			if (hasMockEvaluateFixture(item.itemId)) {
				setDetail(mockEvaluateFixture(item.itemId).detail);
			}
			setDetailPending(false);
			return;
		}
		const controller = new AbortController();
		detailAbortRef.current = controller;
		let cancelled = false;
		(async () => {
			try {
				const res = await playgroundApi.itemDetail(item.itemId).exec();
				if (cancelled || controller.signal.aborted) return;
				if (res.ok && res.body && typeof res.body === "object" && "itemId" in res.body) {
					setDetail(res.body as ItemDetail);
				}
			} finally {
				if (!cancelled && !controller.signal.aborted) setDetailPending(false);
			}
		})();
		return () => {
			cancelled = true;
			controller.abort();
		};
	}, [item.itemId, mockMode, evalState.status]);

	useEffect(() => () => detailAbortRef.current?.abort(), []);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = prevOverflow;
		};
	}, [onClose]);

	function runEval() {
		runEvalForItem(item.itemId, mockMode);
	}

	function reRun() {
		// Discard prior complete/error and start fresh — same shared store
		// transition the row's button does on a re-click.
		resetEvalForItem(item.itemId);
		runEvalForItem(item.itemId, mockMode);
	}

	function cancelRun() {
		cancelEvalForItem(item.itemId);
	}

	// When eval has produced (or is producing) an `outcome.item`, prefer
	// it over the standalone-fetched `detail` — it's the same server data,
	// but having a single source of truth here means the card and the
	// EvaluateResultBody never disagree mid-stream.
	const evalItem =
		evalState.status === "running" || evalState.status === "complete"
			? evalState.outcome.item
			: null;
	const merged = useMemo<ItemDetail>(
		() => ({ ...item, ...(detail ?? {}), ...(evalItem ?? {}) }),
		[item, detail, evalItem],
	);

	const drawer = (
		<>
			<button
				type="button"
				className="row-drawer-backdrop"
				onClick={onClose}
				aria-label="Close drawer"
				tabIndex={-1}
			/>
			<aside className="row-drawer" aria-label="Item detail" role="dialog" aria-modal="true">
				<header className="row-drawer-head">
					<p className="row-drawer-eyebrow">Item detail</p>
					<button
						type="button"
						className="row-drawer-close"
						onClick={onClose}
						title="Close"
						aria-label="Close"
					>
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
							<path d="M6 6l12 12M18 6l-12 12" />
						</svg>
					</button>
				</header>

				<ItemCard
					item={merged}
					detailPending={detailPending}
					specsOpen={specsOpen}
					onToggleSpecs={() => setSpecsOpen((o) => !o)}
				/>

				{!hasRun && (
					<div className="row-drawer-actions">
						<button type="button" onClick={runEval} className="row-drawer-run">
							<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
								<path d="M3 11a5 5 0 0 1 10 0" />
								<path d="M8 11l2.5-2.5" />
								<circle cx="8" cy="11" r="0.6" fill="currentColor" />
							</svg>
							Run Evaluate
						</button>
					</div>
				)}

				{err && (
					<p className="row-drawer-error">
						{err.message}
						{err.upgradeUrl && (
							<>
								{" "}
								<a href={err.upgradeUrl} className="underline underline-offset-2 font-medium">Upgrade →</a>
							</>
						)}
					</p>
				)}

				{hasRun && !err && (
					<section className="row-drawer-result" aria-label="Evaluation">
						<p className="row-drawer-section-label">Evaluation</p>
						<EvaluateResult
							outcome={outcome}
							steps={steps}
							pending={pending}
							onCancel={cancelRun}
							onRerun={reRun}
							hideHero
						/>
					</section>
				)}
			</aside>
		</>
	);

	if (typeof document === "undefined") return null;
	return createPortal(drawer, document.body);
}

/* ============================== item card ============================== */

/**
 * Reseller-decision view of a listing — the answer to "do I buy this?"
 * organized top-to-bottom: see it (gallery) → trust signals (chips) →
 * cost (price + ship + ships-from) → terms (returns + auction state) →
 * what it actually is (specs).
 */
function ItemCard({
	item,
	detailPending,
	specsOpen,
	onToggleSpecs,
}: {
	item: ItemDetail;
	detailPending: boolean;
	specsOpen: boolean;
	onToggleSpecs: () => void;
}) {
	return (
		<div className="row-drawer-card">
			<Gallery item={item} detailPending={detailPending} />
			<TitleBlock item={item} />
			<TrustChips item={item} />
			<PriceStrip item={item} />
			{isAuction(item) && <AuctionInfo item={item} />}
			<KeyFacts item={item} detailPending={detailPending} />
			<SpecsTable
				aspects={item.localizedAspects ?? []}
				detailPending={detailPending}
				expanded={specsOpen}
				onToggle={onToggleSpecs}
			/>
		</div>
	);
}

/* ----------------------------- gallery ----------------------------- */

/**
 * Single-row thumbnail strip with chevron paging. Listings can carry
 * 12+ photos; the prev/next buttons are the primary affordance (scroll
 * still works as fallback). Buttons auto-hide when there's nothing
 * left to scroll in that direction. Each thumb opens its full-res
 * image in a new tab so users can inspect specific angles without
 * leaving the drawer.
 */
function Gallery({ item, detailPending }: { item: ItemDetail; detailPending: boolean }) {
	const all = useMemo(() => {
		return item.images && item.images.length > 0
			? item.images
			: item.image?.imageUrl
				? [item.image.imageUrl]
				: [];
	}, [item.images, item.image?.imageUrl]);

	const stripRef = useRef<HTMLDivElement | null>(null);
	const [canPrev, setCanPrev] = useState(false);
	const [canNext, setCanNext] = useState(false);

	// Recompute scroll affordance on the strip's content/size changing.
	// The 1px tolerance absorbs sub-pixel rounding so the next button
	// doesn't flicker between visible/hidden at the exact scroll end.
	const updateScrollState = useCallback(() => {
		const el = stripRef.current;
		if (!el) return;
		setCanPrev(el.scrollLeft > 1);
		setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
	}, []);

	useEffect(() => {
		updateScrollState();
	}, [updateScrollState, all.length]);

	useEffect(() => {
		const el = stripRef.current;
		if (!el) return;
		const onScroll = () => updateScrollState();
		el.addEventListener("scroll", onScroll, { passive: true });
		const ro = new ResizeObserver(updateScrollState);
		ro.observe(el);
		return () => {
			el.removeEventListener("scroll", onScroll);
			ro.disconnect();
		};
	}, [updateScrollState]);

	function scrollByPage(direction: 1 | -1) {
		const el = stripRef.current;
		if (!el) return;
		// Page by ~3 thumbs at a time so each click visibly advances
		// without overshooting on listings with many photos.
		const step = Math.max(180, Math.floor(el.clientWidth * 0.7));
		el.scrollBy({ left: direction * step, behavior: "smooth" });
	}

	if (all.length === 0) {
		return (
			<div className="row-drawer-gallery-wrap row-drawer-gallery--empty">
				{detailPending ? <div className="row-drawer-gallery-skel pg-result-skel" /> : null}
			</div>
		);
	}

	return (
		<div className="row-drawer-gallery-wrap">
			<div className="row-drawer-gallery" ref={stripRef}>
				{all.map((src, i) => (
					<a
						key={`${src}-${i}`}
						href={src}
						target="_blank"
						rel="noopener noreferrer"
						className="row-drawer-gallery-thumb"
						aria-label={`Image ${i + 1}`}
					>
						<img src={src} alt="" loading="lazy" />
					</a>
				))}
			</div>
			{canPrev && (
				<button
					type="button"
					className="row-drawer-gallery-nav row-drawer-gallery-nav--prev"
					onClick={() => scrollByPage(-1)}
					aria-label="Previous images"
				>
					<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
						<path d="M10 3L5 8l5 5" />
					</svg>
				</button>
			)}
			{canNext && (
				<button
					type="button"
					className="row-drawer-gallery-nav row-drawer-gallery-nav--next"
					onClick={() => scrollByPage(1)}
					aria-label="More images"
				>
					<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
						<path d="M6 3l5 5-5 5" />
					</svg>
				</button>
			)}
		</div>
	);
}

/* ----------------------------- title block ----------------------------- */

function TitleBlock({ item }: { item: ItemDetail }) {
	return (
		<div className="row-drawer-title-block">
			<div className="row-drawer-title-row">
				<span className="row-drawer-title">{item.title}</span>
				<CopyTitleButton text={item.title} />
				<a
					href={cleanItemUrl(item.itemWebUrl)}
					target="_blank"
					rel="noopener noreferrer"
					className="row-drawer-title-link"
					title="Open on eBay"
					aria-label="Open on eBay"
				>
					<svg
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
			</div>
		</div>
	);
}

/* ----------------------------- trust chips ----------------------------- */

/**
 * Top-of-card seller-status badges — Top Rated, Authenticity Guarantee.
 * Returns has its own row in KeyFacts so it's intentionally not
 * duplicated up here. The strip self-hides when neither badge applies,
 * which is the common case for casual sellers.
 */
function TrustChips({ item }: { item: ItemDetail }) {
	const chips: Array<{ text: string; tone: "good" | "warn" }> = [];
	if (item.topRatedBuyingExperience) chips.push({ text: "Top Rated", tone: "good" });
	if (item.authenticityGuarantee) chips.push({ text: "Authenticity Guarantee", tone: "good" });
	if (chips.length === 0) return null;
	return (
		<div className="row-drawer-trust">
			{chips.map((c) => (
				<span key={c.text} className={`row-drawer-trust-chip row-drawer-trust-chip--${c.tone}`}>
					{c.text}
				</span>
			))}
		</div>
	);
}

/* ----------------------------- price strip ----------------------------- */

/**
 * Price + buying mode + ship + ships-from compacted into a single
 * "what does this cost me, and where's it coming from" block. The
 * headline is the asking price; strikethrough shows the
 * marketing/list price when there's a discount; ship + ships-from
 * trail as asides. Buying-mode chips (Best Offer, Auction) sit
 * inline so the strip carries everything that affects the
 * checkout-time number.
 */
function PriceStrip({ item }: { item: ItemDetail }) {
	const priceText = item.price?.value ?? item.lastSoldPrice?.value;
	const ship = item.shippingOptions?.[0];
	const shipCost = ship?.shippingCost;
	const shipFree = ship?.shippingCostType === "FREE_SHIPPING" || shipCost?.value === "0.00";
	const isAuc = isAuction(item);
	const acceptsOffer = item.buyingOptions?.includes("BEST_OFFER") ?? false;
	const shipsFrom = formatLocation(item.itemLocation);

	if (!priceText) return null;
	return (
		<div className="row-drawer-price">
			<div className="row-drawer-price-main">
				<span className="row-drawer-price-val">${priceText}</span>
				{item.originalPrice && item.originalPrice.value !== priceText && (
					<span className="row-drawer-price-strike">${item.originalPrice.value}</span>
				)}
				{item.discountPercentage && (
					<span className="row-drawer-price-discount">-{item.discountPercentage}%</span>
				)}
				{(isAuc || acceptsOffer) && (
					<span className="row-drawer-price-modes">
						{isAuc && <span className="row-drawer-price-mode">Auction</span>}
						{acceptsOffer && <span className="row-drawer-price-mode">Best Offer</span>}
					</span>
				)}
			</div>
			<div className="row-drawer-price-meta">
				{shipFree ? (
					<span>Free shipping</span>
				) : shipCost ? (
					<span>+ ${shipCost.value} shipping</span>
				) : null}
				{shipsFrom && (
					<span>
						{shipFree || shipCost ? "· " : ""}
						Ships from {shipsFrom}
					</span>
				)}
			</div>
		</div>
	);
}

/* ----------------------------- auction info ----------------------------- */

/**
 * Auction-only block — time pressure and current bidding state. Renders
 * above the standard fact rows so it reads first when a buyer lands on
 * an active auction (where every minute matters), instead of being
 * buried inside the generic key-value list.
 */
function AuctionInfo({ item }: { item: ItemDetail }) {
	const timeLeft = item.endsAt ? formatTimeLeft(item.endsAt) : null;
	const bidCount = item.bidCount;
	const currentBid = item.currentBidPrice?.value;
	if (!timeLeft && !bidCount && !currentBid) return null;
	return (
		<div className="row-drawer-auction">
			{timeLeft && (
				<div className="row-drawer-auction-cell">
					<span className="row-drawer-auction-label">Time left</span>
					<span className="row-drawer-auction-val">{timeLeft.text}</span>
					{timeLeft.urgent && <span className="row-drawer-auction-urgent">ending soon</span>}
				</div>
			)}
			{currentBid != null && (
				<div className="row-drawer-auction-cell">
					<span className="row-drawer-auction-label">Current bid</span>
					<span className="row-drawer-auction-val font-mono">${currentBid}</span>
					{bidCount != null && (
						<span className="row-drawer-auction-aside">
							{bidCount} {bidCount === 1 ? "bid" : "bids"}
						</span>
					)}
				</div>
			)}
			{currentBid == null && bidCount != null && (
				<div className="row-drawer-auction-cell">
					<span className="row-drawer-auction-label">Bids</span>
					<span className="row-drawer-auction-val">{bidCount}</span>
				</div>
			)}
		</div>
	);
}

/* ----------------------------- key facts ----------------------------- */

/**
 * The buyer-decision rows — what condition, what brand, what category,
 * who's selling, what the return policy is, and how many other people
 * are watching. Each row is tightly purposed: removing one would lose
 * a question the buyer actually asks at decision time.
 */
function KeyFacts({ item, detailPending }: { item: ItemDetail; detailPending: boolean }) {
	const seller = item.seller;
	const sellerSuffix = seller?.feedbackPercentage
		? `${trimZero(seller.feedbackPercentage)}% · ${seller.feedbackScore != null ? compactNum(seller.feedbackScore) : "—"} feedback`
		: seller?.feedbackScore != null
			? `${compactNum(seller.feedbackScore)} feedback`
			: null;

	const returnsText = formatReturns(item.returnTerms);
	const segs = categorySegments(item.categoryPath);
	// Drawer is narrow; show the trailing 3 segments — those are the
	// product-relevant tier ("Watches › Wristwatches"), not the
	// catalog-tree top ("Jewelry & Watches"). Full path available via
	// the row's title attribute.
	const breadcrumb = segs.length > 3 ? segs.slice(-3) : segs;

	return (
		<dl className="pg-result-facts row-drawer-facts">
			<Row label="Condition">
				{item.condition ? (
					<span className="pg-result-facts-val">{item.condition}</span>
				) : detailPending ? (
					<Skel w={100} />
				) : (
					<span className="pg-result-facts-aside">unknown</span>
				)}
			</Row>

			{item.brand ? (
				<Row label="Brand">
					<span className="pg-result-facts-val">{item.brand}</span>
				</Row>
			) : detailPending ? (
				<Row label="Brand">
					<Skel w={120} />
				</Row>
			) : null}

			<Row label="Category">
				{breadcrumb.length > 0 ? (
					<span className="row-drawer-breadcrumb" title={item.categoryPath}>
						{breadcrumb.map((seg, i) => (
							<span key={`${seg}-${i}`}>
								{i > 0 && <span className="row-drawer-breadcrumb-sep">›</span>}
								{i > 0 ? " " : ""}
								{seg}
							</span>
						))}
					</span>
				) : detailPending ? (
					<Skel w={180} />
				) : (
					<span className="pg-result-facts-aside">—</span>
				)}
			</Row>

			<Row label="Seller">
				{seller?.username ? (
					<>
						<span className="pg-result-facts-val">{seller.username}</span>
						{sellerSuffix && <span className="pg-result-facts-aside">{sellerSuffix}</span>}
					</>
				) : (
					<Skel w={140} />
				)}
			</Row>

			<Row label="Returns">
				{returnsText ? (
					<>
						<span
							className={`pg-result-facts-val${returnsText.warn ? " pg-result-facts-val--warn" : ""}`}
						>
							{returnsText.headline}
						</span>
						{returnsText.aside && <span className="pg-result-facts-aside">{returnsText.aside}</span>}
					</>
				) : detailPending ? (
					<Skel w={140} />
				) : (
					<span className="pg-result-facts-aside">not specified</span>
				)}
			</Row>

			{item.watchCount != null && item.watchCount > 0 && (
				<Row label="Watching">
					<span className="pg-result-facts-val">
						{item.watchCount} {item.watchCount === 1 ? "watcher" : "watchers"}
					</span>
				</Row>
			)}
		</dl>
	);
}

/* ----------------------------- specs table ----------------------------- */

/**
 * Item specifics rendered as a 2-column key/value table — the actual
 * product attributes (Brand, Model, Size, Color, Material, ...). Top N
 * shown by default; "Show all" expander reveals the rest. eBay items
 * routinely carry 15-30 aspects; truncating keeps the card scannable
 * while preserving full access for buyers checking compatibility or
 * authenticating.
 */
function SpecsTable({
	aspects,
	detailPending,
	expanded,
	onToggle,
}: {
	aspects: NonNullable<ItemDetail["localizedAspects"]>;
	detailPending: boolean;
	expanded: boolean;
	onToggle: () => void;
}) {
	if (aspects.length === 0) {
		if (!detailPending) return null;
		// Mirror the real `.row-drawer-specs-row` grid (130px label · 1fr
		// value) so the skeleton lands in the same rhythm the loaded table
		// will occupy — no jump when data arrives. Mixed widths read as
		// "real attributes loading", not a striped placeholder block.
		const skelRows: Array<{ dt: number; dd: number }> = [
			{ dt: 70, dd: 110 },
			{ dt: 60, dd: 90 },
			{ dt: 80, dd: 140 },
			{ dt: 65, dd: 100 },
			{ dt: 90, dd: 120 },
			{ dt: 75, dd: 80 },
		];
		return (
			<div className="row-drawer-specs">
				<div className="row-drawer-specs-head">Specs</div>
				<div className="row-drawer-specs-table" aria-busy="true">
					{skelRows.map((r, i) => (
						<div key={i} className="row-drawer-specs-row">
							<Skel w={r.dt} h={11} />
							<Skel w={r.dd} h={11} />
						</div>
					))}
				</div>
			</div>
		);
	}
	const shown = expanded ? aspects : aspects.slice(0, SPECS_INITIAL_LIMIT);
	const hidden = Math.max(0, aspects.length - SPECS_INITIAL_LIMIT);
	return (
		<div className="row-drawer-specs">
			<div className="row-drawer-specs-head">Specs</div>
			<dl className="row-drawer-specs-table">
				{shown.map((a) => (
					<div key={a.name} className="row-drawer-specs-row">
						<dt>{a.name}</dt>
						<dd>{a.value}</dd>
					</div>
				))}
			</dl>
			{hidden > 0 && (
				<button type="button" className="pg-result-facts-toggle" onClick={onToggle}>
					{expanded ? "Show fewer" : `Show ${hidden} more`}
				</button>
			)}
		</div>
	);
}

/* ============================== helpers ============================== */

function isAuction(item: ItemDetail): boolean {
	return item.buyingOptions?.includes("AUCTION") ?? false;
}

function trimZero(s: string): string {
	return s.replace(/\.0+$/, "");
}

function compactNum(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 10_000) return `${Math.round(n / 1000)}k`;
	if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
}

/**
 * Split eBay's category path into segments. The wire format alternates
 * between `/` (Browse REST) and `|` (some scrape paths), so we accept
 * both and tolerate a stray separator at either end.
 */
function categorySegments(path: string | undefined): string[] {
	if (!path) return [];
	return path
		.split(/[/|]/)
		.map((s) => s.trim())
		.filter(Boolean);
}

/** "San Francisco, CA, US" / "Hong Kong, HK" / null when nothing useful. */
function formatLocation(loc: ItemDetail["itemLocation"]): string | null {
	if (!loc) return null;
	const parts = [loc.city, loc.region, loc.country].filter((p): p is string => !!p && p.trim().length > 0);
	if (parts.length === 0) return null;
	return parts.join(", ");
}

/** Pretty-print return-policy terms. `warn=true` flags negative states (no returns). */
function formatReturns(r: ItemDetail["returnTerms"]): { headline: string; aside?: string; warn: boolean } | null {
	if (!r) return null;
	if (r.accepted === false) return { headline: "No returns", warn: true };
	if (r.accepted === true) {
		const head = r.periodDays != null ? `${r.periodDays}-day returns` : "Returns accepted";
		const payer =
			r.shippingCostPayer === "buyer"
				? "buyer pays return ship"
				: r.shippingCostPayer === "seller"
					? "seller pays return ship"
					: undefined;
		return { headline: head, aside: payer, warn: false };
	}
	return null;
}

/** "2d 4h" / "3h 12m" / "8m" — trims to two coarsest non-zero units. */
function formatTimeLeft(endsAtIso: string): { text: string; urgent: boolean } | null {
	const end = Date.parse(endsAtIso);
	if (!Number.isFinite(end)) return null;
	const ms = end - Date.now();
	if (ms <= 0) return { text: "Ended", urgent: false };
	const totalMin = Math.floor(ms / 60_000);
	const d = Math.floor(totalMin / (60 * 24));
	const h = Math.floor((totalMin % (60 * 24)) / 60);
	const m = totalMin % 60;
	let text: string;
	if (d > 0) text = `${d}d ${h}h`;
	else if (h > 0) text = `${h}h ${m}m`;
	else text = `${m}m`;
	return { text, urgent: ms < 1000 * 60 * 60 * 6 }; // urgent if < 6h
}
