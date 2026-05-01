/**
 * Evaluate result — three blocks:
 *
 *   1. Item hero (image + title + price)
 *   2. Facts grid — six plain-English rows of the numbers a reseller
 *      uses to judge: typical price, sample quality, selling pace,
 *      typical wait, the user's price vs market, and estimated profit
 *      after fees.
 *   3. Recommendation — small action verb + one sentence. Not a
 *      billboard; the facts already tell the story.
 *
 * "Show trace" expander at the bottom for the API call sequence.
 */

import { motion } from "motion/react";
import { useState } from "react";
import { InfoTooltip } from "../ui/InfoTooltip";
import { PriceHistogram } from "./PriceHistogram";
import { Trace } from "./Trace";
import type { EvaluateOutcome } from "./pipelines";
import type { ItemDetail, ItemSummary, MarketStats, Returns, Step } from "./types";


function fmtUsd(cents: number | undefined | null): string {
	if (cents == null) return "—";
	const sign = cents < 0 ? "−" : "";
	return `${sign}$${Math.abs(cents / 100).toFixed(2)}`;
}

function fmtUsdRound(cents: number | undefined | null): string {
	if (cents == null) return "—";
	const sign = cents < 0 ? "−" : "";
	return `${sign}$${Math.abs(Math.round(cents / 100))}`;
}

/**
 * Force eBay's "no redirect" mode on a listing URL. Sold/ended
 * listings that are catalog-linked normally 301 to `/p/<epid>` (the
 * product hub) regardless of which params are on the URL — eBay
 * decides server-side from the listing's own state, not from the
 * query string. Verified by curl test: stripping `epid` alone
 * doesn't help, but appending `?nordt=true` (eBay's internal "no
 * redirect" flag) returns the original listing page directly.
 *
 * Without this, every sold listing of a given SKU collapses to the
 * same destination in the user's browser, which reads as "all the
 * links go to the same page" even though each row's underlying URL
 * is unique. We also drop `epid` and a couple of search-context
 * tracking params to keep the URL tidy. Defensive try/catch so a
 * malformed URL doesn't break the row.
 */
export function cleanItemUrl(url: string): string {
	try {
		const u = new URL(url);
		for (const param of ["epid", "_skw", "itmprp", "tkp"]) {
			u.searchParams.delete(param);
		}
		u.searchParams.set("nordt", "true");
		return u.toString();
	} catch {
		return url;
	}
}

/** "18420" → "18k", "1842" → "1.8k", "342" → "342". Compact feedback-score formatting for the hero meta. */
function compactNum(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 10_000) return `${Math.round(n / 1000)}k`;
	if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
}

/**
 * Read the primary shipping option's cost. eBay returns shippingOptions[0]
 * as the buyer's default shipping. `shippingCostType === "FREE_SHIPPING"`
 * (with a missing or "0.00" cost) is the explicit free path; everything
 * else with a numeric cost is paid shipping. Returns null when shipping is
 * not surfaced at all (some scrape detail rows).
 */
function shippingCents(item: ItemSummary): { cents: number; isFree: boolean } | null {
	const opt = item.shippingOptions?.[0];
	if (!opt) return null;
	const cost = opt.shippingCost;
	const cents = cost ? Math.round(Number.parseFloat(cost.value) * 100) : null;
	const isFree = opt.shippingCostType === "FREE_SHIPPING" || cents === 0;
	if (isFree) return { cents: 0, isFree: true };
	if (cents == null || !Number.isFinite(cents)) return null;
	return { cents, isFree: false };
}

/**
 * Compact seller signal — feedback rate with total count in parentheses.
 * Lives in the Buy-at row's aside chain alongside shipping + returns so
 * all buyer-trust signals are read together at decision time. Returns
 * `null` when no signal is available.
 */
function sellerMetaText(seller: ItemSummary["seller"]): string | null {
	if (!seller) return null;
	const pct = seller.feedbackPercentage ? trimTrailingZero(seller.feedbackPercentage) : null;
	const score = typeof seller.feedbackScore === "number" ? compactNum(seller.feedbackScore) : null;
	if (!pct && !score) return null;
	return pct
		? score
			? `${pct}% feedback (${score})`
			: `${pct}% feedback`
		: `${score} sales`;
}

function trimTrailingZero(s: string): string {
	// "100.0" → "100", "98.5" stays "98.5"
	return s.replace(/\.0+$/, "");
}

/**
 * Compact returns indicator — short label ("30-day returns" / "No returns")
 * for the Buy-at row's aside chain. `warn` flips on for negative states so
 * the caller can color-code risk.
 */
function returnsMetaText(returns: Returns | null): { text: string; warn: boolean } | null {
	if (!returns) return null;
	if (returns.accepted) {
		return {
			text: returns.periodDays != null ? `${returns.periodDays}-day returns` : "Returns OK",
			warn: false,
		};
	}
	return { text: "No returns", warn: true };
}

export function EvaluateResult({
	outcome,
	steps,
	sellWithinDays,
	pending = false,
}: {
	outcome: Partial<EvaluateOutcome>;
	steps: Step[];
	/** When set and the market's typical wait exceeds this, the rec block flags it. */
	sellWithinDays?: number;
	/** True while the chain is still running — sections without data show skeletons. */
	pending?: boolean;
}) {
	const finalPayload = isComplete(outcome) ? (outcome as EvaluateOutcome) : null;
	// Run halted with sections still missing — flag the wrapper so live skeletons
	// (which would normally shimmer) freeze + tint to read as "didn't load",
	// not "still loading".
	const stalled = !pending && !finalPayload && steps.some((s) => s.status === "error");

	return (
		<motion.div
			className="pg-result"
			data-stalled={stalled ? "true" : undefined}
			initial={{ opacity: 0, y: 4 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.25 }}
		>
			<EvaluateResultBody outcome={outcome} sellWithinDays={sellWithinDays} pending={pending} />

			{finalPayload ? (
				<Footer payload={finalPayload} steps={steps} />
			) : (
				<div className="pg-result-foot pg-result-foot--running">
					<Trace steps={steps} />
				</div>
			)}
		</motion.div>
	);
}

/**
 * Body of an Evaluate-style result — hero · histogram · facts. No
 * footer (caller supplies its own trace/copy footer). Exported so
 * Discover's side-detail pane can render the same exact layout for a
 * single deal: feed in `{ item, evaluation, market, soldPool, activePool }`
 * built from the deal + its cluster, get back identical visual output.
 *
 * Skeletons fire when `pending` and the underlying data slot is empty —
 * matches Evaluate's main-result behavior.
 */
export function EvaluateResultBody({
	outcome,
	sellWithinDays,
	pending = false,
}: {
	outcome: Partial<EvaluateOutcome>;
	sellWithinDays?: number;
	pending?: boolean;
}) {
	const candidatePriceCents = outcome.item?.price
		? Math.round(Number.parseFloat(outcome.item.price.value) * 100)
		: null;
	return (
		<>
			{outcome.item ? <ItemHero item={outcome.item} /> : <ItemHeroSkeleton />}

			{outcome.soldPool && outcome.soldPool.length > 0 ? (
				<PriceHistogram
					sold={outcome.soldPool}
					active={outcome.activePool ?? []}
					candidatePriceCents={candidatePriceCents}
				/>
			) : pending ? (
				<ChartSkeleton />
			) : null}

			<Facts
				outcome={outcome}
				pending={pending}
				returns={outcome.returns ?? null}
				sellWithinDays={sellWithinDays}
			/>
		</>
	);
}

function isComplete(o: Partial<EvaluateOutcome>): boolean {
	return !!(o.item && o.evaluation && o.meta);
}

/* ----------------------------- item hero ----------------------------- */

export function ItemHeroSkeleton() {
	return (
		<div className="pg-result-hero pg-result-hero--skel">
			<div className="pg-result-hero-thumb pg-result-skel" />
			<div className="pg-result-hero-body">
				<Skel w={280} h={14} />
				<Skel w={180} h={12} />
			</div>
		</div>
	);
}

export function ChartSkeleton() {
	return <div className="pg-result-chart-skel pg-result-skel" />;
}

/** Hero accepts any item with the visual subset Evaluate + Discover share.
 *  ItemDetail extends ItemSummary, so both shapes satisfy this. */
type HeroItem = ItemSummary & { brand?: string };

export function ItemHero({ item }: { item: HeroItem }) {
	const img = item.image?.imageUrl;
	return (
		<div className="pg-result-hero">
			<div className="pg-result-hero-thumb">
				{img ? <img src={img} alt="" loading="lazy" /> : <span aria-hidden="true">·</span>}
			</div>
			<div className="pg-result-hero-body">
				<div className="pg-result-hero-title-row">
					<span className="pg-result-hero-title">{item.title}</span>
					<CopyTitleButton text={item.title} />
				</div>
				<div className="pg-result-hero-meta">
					{item.condition && <span>{item.condition}</span>}
					{item.brand && <span>{item.brand}</span>}
					{item.price && <span className="font-mono">${item.price.value}</span>}
				</div>
			</div>
			<a
				href={cleanItemUrl(item.itemWebUrl)}
				target="_blank"
				rel="noopener noreferrer"
				className="pg-result-hero-link"
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
	);
}

export function CopyTitleButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	async function copy(e: React.MouseEvent) {
		e.stopPropagation();
		e.preventDefault();
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1200);
		} catch {
			/* clipboard blocked — silent */
		}
	}
	return (
		<button
			type="button"
			onClick={copy}
			className="pg-copy-title"
			data-copied={copied ? "true" : undefined}
			title={copied ? "Copied" : "Copy title"}
			aria-label={copied ? "Copied" : "Copy title"}
		>
			{copied ? (
				<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
					<path d="m3 8 3 3 7-7" />
				</svg>
			) : (
				<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
					<rect x="5" y="5" width="9" height="9" rx="1.5" />
					<path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
				</svg>
			)}
		</button>
	);
}

/* ------------------------------ facts ------------------------------ */

/**
 * Median + p25 + p75 from a sold pool. Cents-denominated. Returns null
 * when fewer than 4 entries (matches server-side
 * MIN_SOLD_FOR_DISTRIBUTION). Sold price prefers `lastSoldPrice`
 * (Marketplace Insights) and falls back to `price` (Browse search).
 */
function soldStats(sold: ItemSummary[]): { medianCents: number; p25Cents: number; p75Cents: number; n: number } | null {
	const cents = sold
		.map((s) => {
			const v = s.lastSoldPrice?.value ?? s.price?.value;
			if (!v) return null;
			const n = Math.round(Number.parseFloat(v) * 100);
			return Number.isFinite(n) ? n : null;
		})
		.filter((n): n is number => n != null)
		.sort((a, b) => a - b);
	if (cents.length < 4) return null;
	const at = (p: number) => cents[Math.min(cents.length - 1, Math.floor(p * cents.length))]!;
	return { medianCents: at(0.5), p25Cents: at(0.25), p75Cents: at(0.75), n: cents.length };
}

function Facts({
	outcome,
	pending,
	returns,
	sellWithinDays,
}: {
	outcome: Partial<EvaluateOutcome>;
	pending: boolean;
	returns: Returns | null;
	/** When set and the recommended exit's expected wait exceeds it, the
	 *  Net profit row appends a "· over your N-day window" warn aside so
	 *  the buyer sees the timeline mismatch without a separate block. */
	sellWithinDays?: number;
}) {
	const evaluation = outcome.evaluation;
	const market = outcome.market;
	const meta = outcome.meta;
	const [soldOpen, setSoldOpen] = useState(false);
	const [activeOpen, setActiveOpen] = useState(false);
	const [bidsOpen, setBidsOpen] = useState(false);
	// Prefer server-computed market stats (have CI + meanDaysToSell);
	// fall back to a quick client-side soldStats for the ad-hoc cases.
	const stats = outcome.soldPool ? soldStats(outcome.soldPool) : null;
	const referenceSaleCents =
		market?.medianCents ?? stats?.medianCents ?? evaluation?.safeBidBreakdown?.estimatedSaleCents ?? null;
	const p25 = market?.p25Cents ?? stats?.p25Cents ?? null;
	const p75 = market?.p75Cents ?? stats?.p75Cents ?? null;
	// `meta` is no longer used in the row text — the LLM filter ratio
	// ("5 matched of 50 fetched") read as jargon for end users. The View
	// button still exposes the kept/rejected breakdown on demand for
	// anyone auditing the filter.
	void meta;

	// Active asks — lowest / highest current asking price across the
	// matched-active pool. `price.value` is the asking price for FIXED_PRICE;
	// for AUCTION it's the starting/current price (close enough for the
	// asks distribution).
	const activePool = outcome.activePool ?? [];
	const askCents = activePool
		.map((a) => (a.price ? Math.round(Number.parseFloat(a.price.value) * 100) : null))
		.filter((c): c is number => c != null && Number.isFinite(c));
	const lowestAskCents = askCents.length > 0 ? Math.min(...askCents) : null;
	const highestAskCents = askCents.length > 0 ? Math.max(...askCents) : null;

	// Active bids — every AUCTION item in the matched-active pool, with
	// items that already have a current bid surfaced first. The View
	// button reuses MatchInline so the user can audit what's being bid
	// on alongside what's still waiting for its first bid.
	const auctionItems = activePool
		.filter((a) => (a.buyingOptions ?? []).includes("AUCTION"))
		.slice()
		.sort((a, b) => {
			const ab = a.currentBidPrice ? Number.parseFloat(a.currentBidPrice.value) : -1;
			const bb = b.currentBidPrice ? Number.parseFloat(b.currentBidPrice.value) : -1;
			return bb - ab;
		});
	const auctionBidCents = auctionItems
		.map((a) => {
			const v = a.currentBidPrice?.value;
			if (!v) return null;
			const cents = Math.round(Number.parseFloat(v) * 100);
			return Number.isFinite(cents) ? cents : null;
		})
		.filter((c): c is number => c != null);
	const highestBidCents = auctionBidCents.length > 0 ? Math.max(...auctionBidCents) : null;

	const candCents = outcome.item?.price
		? Math.round(Number.parseFloat(outcome.item.price.value) * 100)
		: null;
	const lowSample = outcome.meta != null && outcome.meta.soldCount > 0 && outcome.meta.soldCount < 5;

	// Recommendation-driven derived stats — surfaced both in Market pace
	// (which uses the active count for sell-through) and Resells at (rank +
	// vs-avg-sold delta). Computed once here so the rendering paths stay
	// thin and a future tweak (different denominator, different reference)
	// is one place to edit.
	const exitCents =
		evaluation?.recommendedExit?.listPriceCents ?? evaluation?.safeBidBreakdown?.estimatedSaleCents ?? null;
	const myRankAmongAsks =
		exitCents != null && askCents.length > 0
			? askCents.filter((c) => c < exitCents).length + 1
			: null;
	const vsAvgPct =
		exitCents != null && referenceSaleCents != null && referenceSaleCents > 0
			? Math.round(((exitCents - referenceSaleCents) / referenceSaleCents) * 100)
			: null;

	return (
		<dl className="pg-result-facts">
			{/* Sold — what people actually paid. The strongest market signal.
			    Label "Avg. sold" describes the stat directly (the value is
			    the IQR-cleaned median — robust to outliers, which is what
			    "average sold" colloquially means to resellers). Aside
			    order: value · range · count · [View]. */}
			<Row label="Avg. sold">
				{referenceSaleCents != null ? (
					<>
						<span className="pg-result-facts-val">{fmtUsd(referenceSaleCents)}</span>
						{p25 != null && p75 != null && (
							<span className="pg-result-facts-aside">
								{fmtUsdRound(p25)}–{fmtUsdRound(p75)} range
							</span>
						)}
						{outcome.soldPool && outcome.soldPool.length > 0 && (
							<span className="pg-result-facts-aside">· {outcome.soldPool.length} sales</span>
						)}
						{lowSample && (
							<span className="pg-result-facts-warn">low sample</span>
						)}
						{((outcome.soldPool?.length ?? 0) + (outcome.rejectedSoldPool?.length ?? 0)) > 0 && (
							<button
								type="button"
								onClick={() => setSoldOpen((o) => !o)}
								className="pg-result-facts-toggle"
							>
								{soldOpen ? "Hide" : "View"}
							</button>
						)}
					</>
				) : (
					<Skel w={180} />
				)}
			</Row>
			{soldOpen && (
				<MatchInline
					kept={outcome.soldPool ?? []}
					rejected={outcome.rejectedSoldPool ?? []}
				/>
			)}

			{/* Market pace — sell-through (% of recent listings that sold)
			    primary, sales/day + raw sold/active counts as supporting
			    aside. Replaces the older "Days to sell" tile, which read
			    out the mean list→sale duration of comparables; that number
			    mixes "popular SKU" with "patient sellers" and required the
			    same caveats every time. STR cleanly separates the two and
			    is the metric reseller communities already speak. The
			    user-facing "how long would MY listing take" answer lives
			    on the Resells at row below, where it's tied to a price. */}
			<Row label="Market pace">
				{market && market.nObservations > 0 ? (
					(() => {
						const sold = market.nObservations;
						const active = market.asks?.nActive ?? askCents.length;
						const total = sold + active;
						if (total === 0) {
							return <span className="pg-result-facts-val">{market.salesPerDay.toFixed(2)}/day</span>;
						}
						const strPct = Math.round((sold / total) * 100);
						return (
							<>
								<span className="pg-result-facts-val">{strPct}% sell-through</span>
								<span className="pg-result-facts-aside">
									{market.salesPerDay.toFixed(2)}/day · {sold} sold · {active} active
								</span>
								<SellingPaceTag market={market} />
							</>
						);
					})()
				) : pending ? (
					<Skel w={120} />
				) : (
					<span className="pg-result-facts-aside">no data</span>
				)}
			</Row>

			{/* Active asks — what competitors are charging right now. Sold gives
			    past transaction price; this row gives the current competitive
			    floor a reseller would have to undercut (or beat on speed) to
			    win the next sale. */}
			<Row label="Active asks">
				{(() => {
					const rejectedActiveCount = outcome.rejectedActivePool?.length ?? 0;
					const hasAnyActive = activePool.length > 0 || rejectedActiveCount > 0;
					if (!hasAnyActive) {
						return pending ? (
							<Skel w={140} />
						) : (
							<span className="pg-result-facts-aside">no current asks</span>
						);
					}
					return (
						<>
							{lowestAskCents != null ? (
								<>
									<span className="pg-result-facts-val">{fmtUsdRound(lowestAskCents)}</span>
									<span className="pg-result-facts-aside">lowest</span>
									{highestAskCents != null && highestAskCents !== lowestAskCents && (
										<span className="pg-result-facts-aside">
											· {fmtUsdRound(lowestAskCents)}–{fmtUsdRound(highestAskCents)} range
										</span>
									)}
								</>
							) : (
								<span className="pg-result-facts-aside">no priced listings</span>
							)}
							{activePool.length > 0 && (
								<span className="pg-result-facts-aside">· {activePool.length} listings</span>
							)}
							<button
								type="button"
								onClick={() => setActiveOpen((o) => !o)}
								className="pg-result-facts-toggle"
							>
								{activeOpen ? "Hide" : "View"}
							</button>
						</>
					);
				})()}
			</Row>
			{activeOpen && (
				<MatchInline kept={activePool} rejected={outcome.rejectedActivePool ?? []} />
			)}

			{/* Active bids — current bidding action on AUCTION items in the
			    matched-active pool. Reads as live demand pressure: a high bid
			    count + climbing price means the SKU is attracting buyers in
			    real time, separate from the historical sold pool above. */}
			<Row label="Active bids">
				{(() => {
					if (auctionItems.length === 0) {
						return pending ? (
							<Skel w={140} />
						) : (
							<span className="pg-result-facts-aside">no auctions</span>
						);
					}
					return (
						<>
							{highestBidCents != null ? (
								<>
									<span className="pg-result-facts-val">{fmtUsdRound(highestBidCents)}</span>
									<span className="pg-result-facts-aside">highest</span>
									<span className="pg-result-facts-aside">· {auctionBidCents.length} auctions</span>
								</>
							) : (
								<>
									<span className="pg-result-facts-aside">no bids yet</span>
									<span className="pg-result-facts-aside">· {auctionItems.length} auctions</span>
								</>
							)}
							<button
								type="button"
								onClick={() => setBidsOpen((o) => !o)}
								className="pg-result-facts-toggle"
							>
								{bidsOpen ? "Hide" : "View"}
							</button>
						</>
					);
				})()}
			</Row>
			{bidsOpen && <MatchInline kept={auctionItems} rejected={[]} />}

			{/* ─── Deal block — four rows form one arithmetic cascade:
			      Buy at      $A           ← all-in cost (item + ship, or "free shipping")
			      Resells at  $B           ← competition-aware exit · new lowest ask · ~Yd
			      Costs       $C           ← $X fees + $Y ship  (sum of fees on B + outbound ship)
			      Est. profit $B − $C − $A  verdict (+ window-overrun warning)
			    Reading top-to-bottom the user sees: buy $A → resell $B →
			    minus costs $C → profit. `decisionStart` divider sits
			    above "Buy at" so the market-context block above visibly
			    hands off to the action math below. `Buy at` / `Resells
			    at` form an entry/exit verb pair — both directive,
			    parallel structure makes the position lifecycle (in →
			    out) read at a glance. `Est.` prefix on Profit signals
			    it's a model estimate, not a realised number. Costs sit
			    in their own row rather than as a Profit aside so the
			    subtraction is visible — the cents-rounding gap between
			    displayed components and the exact internal Profit math
			    is acceptable trade for the clarity. Replaces the older
			    Buy-under / Listed-at / Net-profit triplet — same data,
			    cleaner story flow. */}

			{/* Buy at — what changes hands at checkout, plus the trust
			    signals a buyer weighs at the moment of clicking buy
			    (seller feedback, return policy). All-in price as the
			    headline; the breakdown ($item + $ship) only appears in
			    the aside when shipping isn't free, so the common
			    free-shipping case stays a single short line. Seller +
			    returns trail the shipping aside as `·`-separated chips
			    so they sit next to the buy decision rather than buried
			    in the item hero overhead. */}
			<Row label="Buy at" decisionStart>
				{outcome.item ? (
					(() => {
						const item = outcome.item!;
						const ship = shippingCents(item);
						const sellerText = sellerMetaText(item.seller);
						const returnsInfo = returnsMetaText(returns);
						const headlineCents =
							ship && !ship.isFree && candCents != null
								? candCents + ship.cents
								: candCents;
						const asides: Array<{ text: string; warn?: boolean }> = [];
						if (ship?.isFree) {
							asides.push({ text: "free shipping" });
						} else if (ship && candCents != null) {
							asides.push({
								text: `${fmtUsd(candCents)} + ${fmtUsd(ship.cents)} ship`,
							});
						}
						if (sellerText) asides.push({ text: sellerText });
						if (returnsInfo) asides.push({ text: returnsInfo.text, warn: returnsInfo.warn });
						return (
							<>
								<span className="pg-result-facts-val">{fmtUsd(headlineCents)}</span>
								{asides.map((a, i) => (
									<span
										key={a.text}
										className={`pg-result-facts-aside${a.warn ? " pg-result-facts-aside--warn" : ""}`}
									>
										{i > 0 ? "· " : ""}
										{a.text}
									</span>
								))}
							</>
						);
					})()
				) : (
					<Skel w={80} />
				)}
			</Row>

			{/* Resells at — directive recommendation: the price our
			    `optimalListPrice` model picked given current competition +
			    hazard model (same number Profit's arithmetic uses). Three
			    asides answer the three questions a reseller asks the
			    moment they see a price: where would I rank against the
			    active competition (#N of M+1), how does it compare to
			    what the market actually paid (−X% vs avg sold), and how
			    long would the listing sit (~Yd to sell). The rank +
			    vs-avg-sold combo replaces the older "new lowest ask /
			    matches lowest ask" prose framing — the rank carries the
			    same lowest-vs-not signal in a quantified form, and the
			    delta to avg sold tells the user whether they're pricing
			    aggressively below market or sitting near it. Skipped when
			    neither recommendedExit nor safeBidBreakdown is computable
			    — keeps the deal block tight rather than showing a
			    placeholder. */}
			<Row
				label="Resells at"
				info="Our recommended list price. Balances sale speed (vs current asks) with per-sale margin (vs sold history)."
			>
				{exitCents == null ? (
					pending ? (
						<Skel w={140} />
					) : (
						<span className="pg-result-facts-aside">insufficient data</span>
					)
				) : (
					<>
						<span className="pg-result-facts-val">{fmtUsdRound(exitCents)}</span>
						{myRankAmongAsks != null && (
							<span className="pg-result-facts-aside">
								#{myRankAmongAsks} of {askCents.length + 1} active
							</span>
						)}
						{vsAvgPct != null && (
							<span className="pg-result-facts-aside">
								· {vsAvgPct >= 0 ? "+" : ""}{vsAvgPct}% vs avg sold
							</span>
						)}
						{evaluation?.recommendedExit?.expectedDaysToSell != null && (
							<span className="pg-result-facts-aside">
								· ~{Math.round(evaluation.recommendedExit.expectedDaysToSell)}d to sell
							</span>
						)}
					</>
				)}
			</Row>

			{/* Costs — fees + outbound ship, surfaced as a discrete row so
			    the subtraction is visible (Resells at − Costs − You pay =
			    Est. profit). Both components come from `safeBidBreakdown`,
			    which is computed against the same exit price the
			    "Resells at" row shows, so the totals are internally
			    consistent. Skipped when safeBidBreakdown is null (no
			    sold pool to derive an exit price from) — without an
			    exit, fees can't be computed. */}
			<Row label="Costs">
				{evaluation?.safeBidBreakdown ? (
					<>
						<span className="pg-result-facts-val">
							{fmtUsdRound(
								evaluation.safeBidBreakdown.feesCents +
									evaluation.safeBidBreakdown.shippingCents,
							)}
						</span>
						<span className="pg-result-facts-aside">
							{fmtUsdRound(evaluation.safeBidBreakdown.feesCents)} fees +{" "}
							{fmtUsdRound(evaluation.safeBidBreakdown.shippingCents)} ship
						</span>
					</>
				) : pending ? (
					<Skel w={140} />
				) : (
					<span className="pg-result-facts-aside">—</span>
				)}
			</Row>

			{/* Est. profit — the bottom-line answer. Color-coded sign on
			    the value carries the verdict directionally (red = loss,
			    green = profit) so the user reads good-or-bad at a glance
			    without needing a separate BUY/HOLD/SKIP chip; the number
			    itself is the conclusion. The only aside is the
			    window-overrun warning when the user set a sell-within
			    budget and the recommended exit blows it. */}
			<Row label="Est. profit">
				{evaluation?.recommendedExit ? (
					<>
						<span
							className={`pg-result-facts-val${
								evaluation.recommendedExit.netCents < 0
									? " pg-result-facts-val--warn"
									: evaluation.recommendedExit.netCents > 0
										? " pg-result-facts-val--good"
										: ""
							}`}
						>
							{evaluation.recommendedExit.netCents >= 0 ? "+" : "−"}
							{fmtUsdRound(Math.abs(evaluation.recommendedExit.netCents))}
						</span>
						{sellWithinDays != null &&
							sellWithinDays > 0 &&
							evaluation.recommendedExit.expectedDaysToSell > sellWithinDays && (
								<span className="pg-result-facts-aside pg-result-facts-aside--warn">
									over your {sellWithinDays}-day window
								</span>
							)}
					</>
				) : evaluation ? (
					// True null path — hazard model couldn't run (no duration
					// data, σ=0, etc). Surface what we have so the row isn't
					// empty; days are missing here by design.
					<>
						<span
							className={`pg-result-facts-val${
								(evaluation.expectedNetCents ?? 0) < 0
									? " pg-result-facts-val--warn"
									: (evaluation.expectedNetCents ?? 0) > 0
										? " pg-result-facts-val--good"
										: ""
							}`}
						>
							{(evaluation.expectedNetCents ?? 0) >= 0 ? "+" : "−"}
							{fmtUsdRound(Math.abs(evaluation.expectedNetCents ?? 0))}
						</span>
						<span className="pg-result-facts-aside">at typical exit</span>
					</>
				) : (
					<Skel w={180} />
				)}
			</Row>
		</dl>
	);
}

/**
 * Inline list of same-product filter outcomes — kept (green) and rejected
 * (greyed) — shown when the user clicks "View" on a Sold for / Active
 * asks row. Lets the user audit the LLM's judgement: which listings were
 * deemed the same product, and which were excluded.
 */
function MatchInline({
	kept,
	rejected,
}: {
	kept: ItemSummary[];
	rejected: ItemSummary[];
}) {
	if (kept.length === 0 && rejected.length === 0) return null;
	return (
		<div className="pg-result-matches">
			{kept.length > 0 && (
				<>
					<div className="pg-result-matches-head">
						<span>Kept · {kept.length}</span>
					</div>
					{kept.map((item) => (
						<MatchRow key={`k-${item.itemId}`} item={item} bucket="match" />
					))}
				</>
			)}
			{rejected.length > 0 && (
				<>
					<div className="pg-result-matches-head pg-result-matches-head--reject">
						<span>Rejected · {rejected.length}</span>
					</div>
					{rejected.map((item) => (
						<MatchRow key={`r-${item.itemId}`} item={item} bucket="reject" />
					))}
				</>
			)}
		</div>
	);
}

/** Static gray placeholder while a row's data is in flight. No animation —
 * the spinner on the Run button + spinner on the running trace step
 * already signal progress; movement here would compete. */
export function Skel({ w = 80, h = 14 }: { w?: number; h?: number }) {
	return (
		<span
			aria-hidden="true"
			className="pg-result-skel"
			style={{ width: `${w}px`, height: `${h}px` }}
		/>
	);
}

export function Row({
	label,
	children,
	decisionStart,
	info,
}: {
	label: string;
	children: React.ReactNode;
	/** Mark this row as the first of the buyer-decision block (Buy at →
	 *  Resells at → Costs → Est. profit). Draws a divider above so the
	 *  market context visibly hands off to the action rows. */
	decisionStart?: boolean;
	/** When set, renders an `InfoTooltip` (Radix-backed shadcn-style
	 *  popup) next to the label. Used for rows whose value isn't
	 *  obvious from the column name alone (e.g. model-picked exit
	 *  price). Pass plain text or rich JSX. */
	info?: React.ReactNode;
}) {
	return (
		<div className={decisionStart ? "pg-result-facts-decision-start" : undefined}>
			<dt>
				{label}
				{info && <InfoTooltip>{info}</InfoTooltip>}
			</dt>
			<dd>{children}</dd>
		</div>
	);
}

function MatchRow({
	item,
	bucket,
}: {
	item: ItemSummary;
	bucket: "match" | "reject";
}) {
	const priceText = item.lastSoldPrice?.value ?? item.price?.value;
	const isAuction = item.buyingOptions?.includes("AUCTION") ?? false;
	const acceptsOffer = item.buyingOptions?.includes("BEST_OFFER") ?? false;
	const currentBid = item.currentBidPrice?.value;
	// One tag per row, picked by the seller's listing mode. AUCTION is
	// the dominant case to flag (price moves) so it wins over BEST_OFFER
	// when both are present (eBay technically allows it, rare in
	// practice). The bid sub-tag tells the reseller whether the auction
	// is hot ("$X bid") or sitting cold ("no bids") — matters for
	// pricing inference: cold auctions mean the visible asks may be
	// over-anchored vs actual demand.
	let modeTag: string | null = null;
	if (isAuction) {
		modeTag = currentBid ? `Auction · $${currentBid} bid` : "Auction · no bids";
	} else if (acceptsOffer) {
		modeTag = "Best Offer";
	}
	return (
		<div className={`pg-result-matches-row pg-result-matches-row--${bucket}`}>
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

function SellingPaceTag({ market }: { market: MarketStats }) {
	const sd = market.salesPerDay;
	if (sd >= 1) return <span className="pg-result-facts-aside pg-result-facts-aside--good">fast</span>;
	if (sd >= 0.2) return <span className="pg-result-facts-aside">steady</span>;
	if (sd > 0) return <span className="pg-result-facts-aside pg-result-facts-aside--warn">slow</span>;
	return <span className="pg-result-facts-aside">—</span>;
}

/* ----------------------------- footer (copy + trace) ----------------------------- */

export function Footer({ payload, steps }: { payload: unknown; steps: Step[] }) {
	// Default open — the trace was visible while the chain ran, so collapsing
	// it the moment the run completes feels like the table just disappeared.
	// User can still hide if they want.
	const [open, setOpen] = useState(true);
	const [copied, setCopied] = useState(false);
	async function copy() {
		try {
			await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			/* ignore */
		}
	}
	return (
		<div className="pg-result-foot">
			<div className="pg-result-foot-row">
				<button type="button" onClick={copy} className="pg-result-copy">
					<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
						<rect x="5" y="5" width="9" height="9" rx="1.5" />
						<path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
					</svg>
					{copied ? "Copied" : "Copy JSON"}
				</button>
				<button type="button" className="pg-result-trace-toggle" onClick={() => setOpen((o) => !o)}>
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
