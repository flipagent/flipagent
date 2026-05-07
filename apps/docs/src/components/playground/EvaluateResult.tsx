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
import { useEffect, useRef, useState } from "react";
import { InfoTooltip } from "../ui/InfoTooltip";
import { PriceHistogram } from "./PriceHistogram";
import { Trace } from "./Trace";
import type { EvaluateOutcome } from "./pipelines";
import type { EvaluateMeta, ItemDetail, ItemSummary, MarketStats, Returns, Step } from "./types";


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
function sellerMetaText(seller: ItemSummary["seller"]): { text: string; level?: "caution" | "warn" } | null {
	if (!seller) return null;
	const pct = seller.feedbackPercentage ? trimTrailingZero(seller.feedbackPercentage) : null;
	const score = typeof seller.feedbackScore === "number" ? seller.feedbackScore : null;
	if (!pct && score == null) return null;
	const text = pct
		? score != null
			? `${pct}% feedback (${compactNum(score)})`
			: `${pct}% feedback`
		: `${compactNum(score ?? 0)} sales`;
	// Risk tiers, mirroring `assessRisk`'s sensitivity to count + percent:
	//   warn (red): zero feedback — actively suspicious, especially on
	//     high-value items (burner accounts, banned-and-relisted).
	//   caution (orange): thin feedback (<10) or sub-95% positive — model
	//     trusts these less; surface so the buyer notices.
	let level: "caution" | "warn" | undefined;
	const pctNum = pct ? Number.parseFloat(pct) : null;
	if (score === 0) level = "warn";
	else if ((score != null && score < 10) || (pctNum != null && pctNum < 95)) level = "caution";
	return { text, level };
}

function trimTrailingZero(s: string): string {
	// "100.0" → "100", "98.5" stays "98.5"
	return s.replace(/\.0+$/, "");
}

/**
 * Compact returns indicator — short label ("30-day returns" / "No returns")
 * for the Buy-at row's aside chain. `level=warn` flips on for explicit
 * "no returns" so the caller can color-code that fraud-loss exposure.
 * Returns null when `returnTerms` wasn't surfaced by upstream — the
 * model assumes worst case internally, but the UI stays silent rather
 * than guessing.
 */
function returnsMetaText(returns: Returns | null): { text: string; level?: "warn" } | null {
	if (!returns) return null;
	if (returns.accepted) {
		return { text: returns.periodDays != null ? `${returns.periodDays}-day returns` : "Returns OK" };
	}
	return { text: "No returns", level: "warn" };
}

export function EvaluateResult({
	outcome,
	steps,
	sellWithinDays,
	minNetCents,
	pending = false,
	onCancel,
	onRerun,
	hideHero = false,
}: {
	outcome: Partial<EvaluateOutcome>;
	steps: Step[];
	/** When set and the market's typical wait exceeds this, the rec block flags it. */
	sellWithinDays?: number;
	/** Caller's profit target. Drives the "below target net" aside on the
	 *  Est. profit row — shown only when (a) the server flagged the row
	 *  as below_min_net AND (b) the caller actually set a non-zero target.
	 *  Default zero / undefined means "no target", and the aside stays
	 *  hidden (the red E[net] number already conveys the loss). */
	minNetCents?: number;
	/** True while the chain is still running — sections without data show skeletons. */
	pending?: boolean;
	/** Pending → Cancel button on the footer-left. Complete → Re-run. Both
	 *  optional; without them the footer renders without the action button
	 *  (back-compat for callers that haven't wired the handlers). */
	onCancel?: () => void;
	onRerun?: () => void;
	/** Forwarded to EvaluateResultBody. The row drawer renders its own
	 *  ItemCard above this and would otherwise double up the hero. */
	hideHero?: boolean;
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
			<EvaluateResultBody
				outcome={outcome}
				sellWithinDays={sellWithinDays}
				minNetCents={minNetCents}
				pending={pending}
				hideHero={hideHero}
			/>

			<EvalFooter
				pending={pending}
				payload={finalPayload}
				steps={steps}
				onCancel={onCancel}
				onRerun={onRerun}
			/>
		</motion.div>
	);
}

/**
 * Body of an Evaluate-style result — hero · histogram · facts. No
 * footer (caller supplies its own trace/copy footer). Exported so
 * a side-detail pane can render the same exact layout for a single
 * variant: feed in `{ item, evaluation, market, soldPool, activePool }`
 * and get back identical visual output.
 *
 * Skeletons fire when `pending` and the underlying data slot is empty —
 * matches Evaluate's main-result behavior.
 *
 * `hideHero` lets a parent supply its own anchor hero (e.g. the row
 * drawer renders the item card itself, then drops Evaluate's market
 * analysis in below — same visual hero, no double-render).
 */
export function EvaluateResultBody({
	outcome,
	sellWithinDays,
	minNetCents,
	pending = false,
	hideHero = false,
}: {
	outcome: Partial<EvaluateOutcome>;
	sellWithinDays?: number;
	minNetCents?: number;
	pending?: boolean;
	hideHero?: boolean;
}) {
	// Detect the moment `preliminary` flips false (the post-filter
	// `digest` partial just landed). We hold a `data-just-confirmed`
	// flag on the analysis wrapper for ~600ms so CSS can briefly tint
	// every value brand-orange — a Bloomberg-style "fresh number" flash
	// that signals the numbers are now sharpened.
	const [justConfirmed, setJustConfirmed] = useState(false);
	const prevPreliminary = useRef(outcome.preliminary);
	useEffect(() => {
		if (prevPreliminary.current === true && outcome.preliminary === false) {
			setJustConfirmed(true);
			const t = setTimeout(() => setJustConfirmed(false), 700);
			return () => clearTimeout(t);
		}
		prevPreliminary.current = outcome.preliminary;
	}, [outcome.preliminary]);
	// Suspicious-comp toggle. Default OFF — flagged comps are excluded
	// from the displayed pools, headline `market`/`evaluation`, histogram,
	// and Facts rows. Toggling ON swaps to `marketAll`/`evaluationAll`
	// (server-precomputed against the full pool) and re-includes the
	// flagged rows in the displayed lists with a tint + reason on hover.
	const [showSuspicious, setShowSuspicious] = useState(false);
	const suspiciousIds = outcome.suspiciousIds ?? {};
	const suspiciousCount = Object.keys(suspiciousIds).length;
	const view = useEffectiveOutcome(outcome, showSuspicious);
	const candidatePriceCents = view.item?.price
		? Math.round(Number.parseFloat(view.item.price.value) * 100)
		: null;
	// Matcher rejected every candidate — empty matched pool. Distinct from
	// "still loading" (where meta is undefined). The downstream rows
	// (Avg sold, Resells at, Est. profit) all degrade to placeholders or
	// misleading numbers computed against a zero market; surface the real
	// reason up here instead so the user knows the rec block isn't broken.
	// Uses the cleaned (default-view) counts so the empty-state message
	// reflects what the user is actually looking at.
	const effSoldKept = (view.soldPool ?? []).length;
	const effActiveKept = (view.activePool ?? []).length;
	const noMatches =
		view.meta != null &&
		effSoldKept === 0 &&
		effActiveKept === 0 &&
		(view.meta.soldRejected > 0 || view.meta.activeRejected > 0);
	const noSoldMatched =
		view.meta != null &&
		effSoldKept === 0 &&
		(view.meta.soldRejected > 0 || view.meta.activeRejected > 0);
	const noActiveMatched =
		view.meta != null &&
		effActiveKept === 0 &&
		(view.meta.soldRejected > 0 || view.meta.activeRejected > 0);
	return (
		<>
			{!hideHero && (outcome.item ? <ItemHero item={outcome.item} /> : <ItemHeroSkeleton />)}

			{noMatches && <NoMatchesBanner meta={view.meta!} />}

			{/* Analysis area — chart + facts. Wrapped so CSS can flash
			    every value brand-orange for 700ms when the post-filter
			    digest lands (`data-just-confirmed`). Per-value shimmer
			    while data is still tentative is handled at the row
			    level; this wrapper only carries the confirm-moment
			    cue. */}
			<div
				className="pg-result-analysis"
				data-just-confirmed={justConfirmed ? "true" : undefined}
			>
				{suspiciousCount > 0 && (
					<SuspiciousToggle
						count={suspiciousCount}
						on={showSuspicious}
						onChange={setShowSuspicious}
					/>
				)}
				{(() => {
					// Histogram active series is BIN-only — auction `price`
					// values are starting/current bids, unstable until
					// close, so mixing them flattens the BIN distribution.
					// Auctions get their own row (Active bids) below.
					const binActive = (view.activePool ?? []).filter((a) =>
						(a.buyingOptions ?? []).includes("FIXED_PRICE"),
					);
					const haveSold = (view.soldPool?.length ?? 0) > 0;
					const haveBinActive = binActive.length > 0;
					if (haveSold || haveBinActive) {
						return (
							<PriceHistogram
								sold={view.soldPool ?? []}
								active={binActive}
								candidatePriceCents={candidatePriceCents}
							/>
						);
					}
					return pending ? <ChartSkeleton /> : null;
				})()}

				<Facts
					outcome={view}
					pending={pending}
					returns={view.returns ?? null}
					sellWithinDays={sellWithinDays}
					minNetCents={minNetCents}
					noSoldMatched={noSoldMatched}
					noActiveMatched={noActiveMatched}
				/>
			</div>
		</>
	);
}

/**
 * Derive the "current view" outcome from the raw outcome + the
 * suspicious toggle state. Default (off) excludes flagged comps from
 * the pools and uses the server-precomputed `market` / `evaluation`
 * (also computed against the cleaned pool). Toggle on swaps to
 * `marketAll` / `evaluationAll` and re-includes flagged comps in the
 * pools — UI-only swap, no server roundtrip.
 *
 * Memoised against the toggle state + outcome identity so downstream
 * `Facts` / `PriceHistogram` stay referentially stable across other
 * unrelated re-renders.
 */
function useEffectiveOutcome(outcome: Partial<EvaluateOutcome>, showSuspicious: boolean): Partial<EvaluateOutcome> {
	const suspiciousIds = outcome.suspiciousIds ?? {};
	if (showSuspicious) {
		return {
			...outcome,
			...(outcome.marketAll ? { market: outcome.marketAll } : {}),
			...(outcome.evaluationAll ? { evaluation: outcome.evaluationAll } : {}),
		};
	}
	if (Object.keys(suspiciousIds).length === 0) return outcome;
	const cleanSold = (outcome.soldPool ?? []).filter((it) => !suspiciousIds[it.itemId]);
	const cleanActive = (outcome.activePool ?? []).filter((it) => !suspiciousIds[it.itemId]);
	return {
		...outcome,
		soldPool: cleanSold,
		activePool: cleanActive,
	};
}

/**
 * Compact inline toggle: `N hidden · show / hide`. Sits at the top of
 * the analysis area, right-aligned. Tiny mono caps, no border, behaves
 * like the existing `[View]` row togglers — minimal visual weight.
 * Renders only when `count > 0`.
 */
function SuspiciousToggle({
	count,
	on,
	onChange,
}: {
	count: number;
	on: boolean;
	onChange: (next: boolean) => void;
}) {
	return (
		<button
			type="button"
			className="pg-suspicious-toggle"
			data-on={on ? "true" : undefined}
			onClick={() => onChange(!on)}
			aria-pressed={on}
			title={
				on
					? "Showing suspicious comps in the median + recommendation. Hidden by default — flagged by the post-match risk filter (Bayesian P_fraud > 40%)."
					: `${count} comp${count === 1 ? "" : "s"} flagged by the post-match risk filter (Bayesian P_fraud > 40%). Excluded from median + recommendation.`
			}
		>
			{count} sus · <span className="pg-suspicious-toggle-action">{on ? "hide" : "show"}</span>
		</button>
	);
}

function isComplete(o: Partial<EvaluateOutcome>): boolean {
	return !!(o.item && o.evaluation && o.meta);
}

/* ----------------------------- no matches banner ----------------------------- */

/**
 * Surfaced between the hero and the (now-blank) market rows when the
 * LLM same-product matcher rejected every candidate. Without it the
 * row block reads as broken — `$0–$0`, "insufficient data", a
 * misleading "Est. profit −$X". The real reason (different reference,
 * size, condition, brand) lives in the trace's filter step + the
 * `match_decisions` table; this banner makes the verdict legible
 * without forcing the user to drill in.
 */
function NoMatchesBanner({ meta }: { meta: EvaluateMeta }) {
	const total = meta.soldRejected + meta.activeRejected;
	return (
		<div className="pg-result-no-matches">
			<svg
				width="14"
				height="14"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
				className="pg-result-no-matches-icon"
			>
				<circle cx="8" cy="8" r="6.5" />
				<path d="M5.5 5.5l5 5M10.5 5.5l-5 5" />
			</svg>
			<div className="pg-result-no-matches-body">
				<p className="pg-result-no-matches-title">No comparable products in the market</p>
				<p className="pg-result-no-matches-sub">
					Scanned {meta.soldRejected} sold + {meta.activeRejected} active ({total} total). The same-product
					matcher rejected all of them — different reference, size, condition, or brand. Click <strong>View</strong>
					{" "}on the rows below for per-listing reasons.
				</p>
			</div>
		</div>
	);
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

/** Hero accepts any item with the visual subset Evaluate + Sourcing share.
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
	minNetCents,
	noSoldMatched = false,
	noActiveMatched = false,
}: {
	outcome: Partial<EvaluateOutcome>;
	pending: boolean;
	returns: Returns | null;
	/** When set and the recommended exit's expected wait exceeds it, the
	 *  Net profit row appends a "· over your N-day window" warn aside so
	 *  the buyer sees the timeline mismatch without a separate block. */
	sellWithinDays?: number;
	/** Caller's profit target (cents). Gates the "below your $X target"
	 *  aside so it only shows when the user actually set a target —
	 *  default 0 leaves the aside hidden (the red number says enough). */
	minNetCents?: number;
	/** Sold pool empty after the matcher (active may still have matches).
	 *  Hides the misleading `expectedNetCents` fallback on Est. profit and
	 *  swaps Avg. sold's value for a placeholder + a View into the rejected
	 *  sold pool. */
	noSoldMatched?: boolean;
	/** Active pool empty after the matcher (sold may still have matches).
	 *  Active asks degrades to a placeholder + a View into the rejected
	 *  active pool. */
	noActiveMatched?: boolean;
}) {
	const evaluation = outcome.evaluation;
	const market = outcome.market;
	const meta = outcome.meta;
	// `tentative` flag — true any time the row's value is derived from
	// pool data that hasn't been filter-confirmed yet. Covers the early
	// window (raw `soldPool` / `activePool` from search, no
	// `preliminary` flag yet) AND the preliminary-digest window (where
	// `outcome.preliminary === true`). Flips false only when the
	// post-filter digest explicitly lands. Non-filter rows below (Buy
	// at, Resells at, Costs, Est. profit) draw on detail / scoring so
	// they stay normal regardless.
	const tentative = outcome.preliminary !== false;
	const [soldOpen, setSoldOpen] = useState(false);
	const [activeOpen, setActiveOpen] = useState(false);
	const [bidsOpen, setBidsOpen] = useState(false);
	// Est. profit row defaults to the success-case net ("if it sells, what
	// do I make"). Toggling reveals the risk-adjusted NPV (E[net]) which
	// folds in P_fraud + time discount + max-loss. Persisted per-user so
	// power users who prefer the risk-adj view stay in it across sessions.
	const [riskAdjOpen, setRiskAdjOpen] = useState<boolean>(() => {
		if (typeof window === "undefined") return false;
		try {
			return window.localStorage.getItem("flipagent.eval.riskAdjView") === "1";
		} catch {
			return false;
		}
	});
	const toggleRiskAdj = (): void => {
		setRiskAdjOpen((prev) => {
			const next = !prev;
			try {
				window.localStorage.setItem("flipagent.eval.riskAdjView", next ? "1" : "0");
			} catch {
				/* private mode / quota — fine to drop persistence */
			}
			return next;
		});
	};
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

	// Split the matched-active pool by buying option so each row tells
	// a clean story:
	//
	//   - `binPool` — listings selling at a fixed price (BIN). Their
	//     `price.value` is the actual ask, so the lowest BIN is the
	//     real competitive floor for a reseller pricing their own BIN.
	//   - `auctionItems` — listings up for auction. Their `price.value`
	//     is a starting / current bid, which is unstable until close;
	//     mixing those into "Active asks" produced a misleading "lowest
	//     $1" read.
	//   - Best-Offer count — how many of the BIN listings explicitly
	//     accept offers. Useful negotiation signal.
	//
	// A listing can carry both `AUCTION` and `FIXED_PRICE` (auction
	// with Buy-It-Now). It lands in BOTH pools intentionally — both
	// views are valid signals for that listing.
	const activePool = outcome.activePool ?? [];
	const binPool = activePool.filter((a) => (a.buyingOptions ?? []).includes("FIXED_PRICE"));
	const offerCount = binPool.filter((a) => (a.buyingOptions ?? []).includes("BEST_OFFER")).length;
	const askCents = binPool
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
	const queueAhead = evaluation?.recommendedExit?.queueAhead ?? null;
	const asksAbove = evaluation?.recommendedExit?.asksAbove ?? null;
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
			<Row label="Avg. sold" tentative={tentative}>
				{noSoldMatched ? (
					// Sold pool empty after the matcher — `market.medianCents` is 0 here,
					// which would render as "$0.00 / $0–$0 range" and read as a real
					// average. Show the placeholder; the View button below opens the
					// rejected sold pool with per-listing reasons.
					<span className="pg-result-facts-aside">no comparable products</span>
				) : referenceSaleCents != null && referenceSaleCents > 0 ? (
					<>
						<span className="pg-result-facts-val">{fmtUsd(referenceSaleCents)}</span>
						{p25 != null && p75 != null && p25 > 0 && p75 > 0 && (
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
					</>
				) : pending ? (
					<Skel w={180} />
				) : (
					<span className="pg-result-facts-aside">no sold data</span>
				)}
				{/* View attaches whenever there's anything to inspect — kept OR
				 * rejected. Lives outside the value branches so a 0-matched run
				 * still surfaces the rejected pool, and a populated run still
				 * gets the same affordance. */}
				{((outcome.soldPool?.length ?? 0) + (outcome.rejectedSoldPool?.length ?? 0)) > 0 && (
					<button
						type="button"
						onClick={() => setSoldOpen((o) => !o)}
						className="pg-result-facts-toggle"
					>
						{soldOpen ? "Hide" : "View"}
					</button>
				)}
			</Row>
			{soldOpen && (
				<MatchInline
					kept={outcome.soldPool ?? []}
					rejected={outcome.rejectedSoldPool ?? []}
					reasons={outcome.rejectionReasons}
					suspiciousIds={outcome.suspiciousIds}
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
			<Row label="Market pace" tentative={tentative}>
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
								<span className="pg-result-facts-aside">{market.salesPerDay.toFixed(2)}/day</span>
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

			{/* Active asks — BIN-only competitive floor. Auctions are
			    excluded here because their `price` is a starting / current
			    bid, not what the seller will accept now; mixing them in
			    used to surface a misleading "lowest $1" read. The
			    auction view lives in the Active bids row below. */}
			<Row label="Active asks" tentative={tentative}>
				{noActiveMatched ? (
					// Active pool empty after the matcher — symmetric to Avg. sold's
					// `noSoldMatched` branch. View attaches below and opens the
					// rejected active pool with per-listing reasons.
					<span className="pg-result-facts-aside">no comparable listings</span>
				) : binPool.length === 0 && (outcome.rejectedActivePool?.length ?? 0) === 0 ? (
					pending ? (
						<Skel w={140} />
					) : (
						<span className="pg-result-facts-aside">no current asks</span>
					)
				) : (
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
						{binPool.length > 0 && (
							<span className="pg-result-facts-aside">
								· {binPool.length} {binPool.length === 1 ? "listing" : "listings"}
							</span>
						)}
						{offerCount > 0 && (
							<span className="pg-result-facts-aside">
								· {offerCount} accept{offerCount === 1 ? "s" : ""} offers
							</span>
						)}
					</>
				)}
				{((outcome.activePool?.length ?? 0) + (outcome.rejectedActivePool?.length ?? 0)) > 0 && (
					<button
						type="button"
						onClick={() => setActiveOpen((o) => !o)}
						className="pg-result-facts-toggle"
					>
						{activeOpen ? "Hide" : "View"}
					</button>
				)}
			</Row>
			{activeOpen && (
				<MatchInline
					kept={activePool}
					rejected={outcome.rejectedActivePool ?? []}
					reasons={outcome.rejectionReasons}
					suspiciousIds={outcome.suspiciousIds}
				/>
			)}

			{/* Active bids — current bidding action on AUCTION items in the
			    matched-active pool. Reads as live demand pressure: a high bid
			    count + climbing price means the SKU is attracting buyers in
			    real time, separate from the historical sold pool above. */}
			<Row label="Active bids" tentative={tentative}>
				{(() => {
					if (auctionItems.length === 0) {
						return pending ? (
							<Skel w={140} />
						) : (
							<span className="pg-result-facts-aside">no auctions</span>
						);
					}
					const total = auctionItems.length;
					const withBids = auctionBidCents.length;
					const auctionLabel = `${total} ${total === 1 ? "auction" : "auctions"}`;
					return (
						<>
							{highestBidCents != null ? (
								<>
									<span className="pg-result-facts-val">{fmtUsdRound(highestBidCents)}</span>
									<span className="pg-result-facts-aside">highest</span>
									<span className="pg-result-facts-aside">
										· {auctionLabel}
										{withBids < total ? ` (${withBids} with bids)` : ""}
									</span>
								</>
							) : (
								<>
									<span className="pg-result-facts-aside">no bids yet</span>
									<span className="pg-result-facts-aside">· {auctionLabel}</span>
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
						const sellerInfo = sellerMetaText(item.seller);
						const returnsInfo = returnsMetaText(returns);
						const headlineCents =
							ship && !ship.isFree && candCents != null
								? candCents + ship.cents
								: candCents;
						const asides: Array<{ text: string; level?: "caution" | "warn" }> = [];
						if (ship?.isFree) {
							asides.push({ text: "free shipping" });
						} else if (ship && candCents != null) {
							asides.push({
								text: `${fmtUsd(candCents)} + ${fmtUsd(ship.cents)} ship`,
							});
						}
						if (sellerInfo) asides.push(sellerInfo);
						if (returnsInfo) asides.push(returnsInfo);
						return (
							<>
								<span className="pg-result-facts-val">{fmtUsd(headlineCents)}</span>
								{asides.map((a, i) => (
									<span
										key={a.text}
										className={`pg-result-facts-aside${
											a.level === "warn"
												? " pg-result-facts-aside--warn"
												: a.level === "caution"
													? " pg-result-facts-aside--caution"
													: ""
										}`}
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
			    `recommendListPrice` model picked given current competition
			    + queue model (same number Profit's arithmetic uses). Three
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
						<span className="pg-result-facts-aside">—</span>
					)
				) : (
					<>
						<span className="pg-result-facts-val">{fmtUsdRound(exitCents)}</span>
						{queueAhead != null && asksAbove != null && (
							<span className="pg-result-facts-aside">
								{queueAhead} cheaper · {asksAbove} above
							</span>
						)}
						{vsAvgPct != null && (
							<span className="pg-result-facts-aside">
								· {vsAvgPct >= 0 ? "+" : ""}{vsAvgPct}% vs avg sold
							</span>
						)}
						{evaluation?.recommendedExit && (
							<span className="pg-result-facts-aside">
								· ~{Math.round(evaluation.recommendedExit.expectedDaysToSell)}d
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

			{/* Est. profit — the bottom-line answer. Color is driven by the
			    `evaluation.rating` (the actual verdict from the math), not
			    just the sign or the toggle — so a positive successNet that
			    reads red because the rating is skip stays red whether the
			    user is looking at the success or risk-adjusted number. The
			    default value is `successNetCents` ("if it sells") because
			    that matches the user's mental model; `expectedNetCents`
			    (NPV after P_fraud + time discount) is one click away on
			    the per-row toggle for power users. */}
			<Row
				label="Est. profit"
				info="How much you make if the listing actually sells. Toggle to a smaller, risk-adjusted version that factors in how often this kind of listing falls through, how long it takes to sell, and how bad a worst-case loss would be."
			>
				{evaluation?.recommendedExit ? (
					(() => {
						const successNet = evaluation.successNetCents ?? null;
						const riskNet = evaluation.expectedNetCents ?? 0;
						// Show the toggle only when the two numbers actually
						// differ — when P_fraud≈0 and discountFactor≈1 they
						// collapse to the same value and a toggle would be
						// pointless UI noise.
						const canToggle = successNet != null && successNet !== riskNet;
						const showRiskAdj = canToggle && riskAdjOpen;
						const displayedNet = showRiskAdj ? riskNet : (successNet ?? riskNet);
						return (
							<>
								<span
									className={`pg-result-facts-val${
										evaluation.rating === "skip"
											? " pg-result-facts-val--warn"
											: evaluation.rating === "buy"
												? " pg-result-facts-val--good"
												: ""
									}`}
								>
									{displayedNet >= 0 ? "+" : "−"}
									{fmtUsdRound(Math.abs(displayedNet))}
								</span>
						{/* Only flag "below target" when the user explicitly set
						    a non-zero profit target AND the server reasoned the
						    skip on it. With minNet=0 (default) the red E[net]
						    number already conveys the loss; the aside would just
						    repeat in words what the colour says. Other skip
						    reasons (insufficient_data, no_market, vetoed) are
						    not target-related and don't get this aside. */}
						{evaluation.reasonCode === "below_min_net" &&
							minNetCents != null &&
							minNetCents > 0 && (
								<span className="pg-result-facts-aside pg-result-facts-aside--warn">
									below your {fmtUsdRound(minNetCents)} target
								</span>
							)}
						{/* Silent-red guard: when the value is positive but the
						    rating is skip for non-target reasons, the colour
						    alone is mute. Surface a short reason chip so the
						    user knows why they're being told "no". */}
						{evaluation.reasonCode === "insufficient_data" && (
							<span className="pg-result-facts-aside pg-result-facts-aside--warn">low sample</span>
						)}
						{evaluation.reasonCode === "no_market" && (
							<span className="pg-result-facts-aside pg-result-facts-aside--warn">no market</span>
						)}
						{evaluation.reasonCode === "vetoed" && (
							<span className="pg-result-facts-aside pg-result-facts-aside--warn">vetoed</span>
						)}
						{sellWithinDays != null &&
							sellWithinDays > 0 &&
							evaluation.recommendedExit.expectedDaysToSell > sellWithinDays && (
								<span className="pg-result-facts-aside pg-result-facts-aside--warn">
									over your {sellWithinDays}-day window
								</span>
							)}
								{canToggle && (
									<button
										type="button"
										onClick={toggleRiskAdj}
										className="pg-result-facts-toggle"
										title={
											showRiskAdj
												? "Show success-case net (if it sells, what you make)"
												: "Show risk-adjusted NPV (P_fraud + time discount + max-loss)"
										}
									>
										{showRiskAdj ? "Show success" : "Show risk-adj"}
									</button>
								)}
							</>
						);
					})()
				) : evaluation && !noSoldMatched ? (
					// True null path — hazard model couldn't run (no duration
					// data, σ=0, etc) but a sold pool existed. Surface what we
					// have so the row isn't empty; days are missing here by design.
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
				) : evaluation && noSoldMatched ? (
					// Sold pool empty — `expectedNetCents` here is `score(item,
					// EMPTY_MARKET)` which subtracts the buy price from a $0
					// sale, producing a misleading "negative profit" that's
					// just the buy cost. Suppress it; the banner up top (when
					// active is also empty) or the Avg. sold row's "no
					// comparable products" already carries the signal.
					<span className="pg-result-facts-aside">—</span>
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
 * deemed the same product, and which were excluded. Rejected rows carry
 * the LLM's per-listing reason underneath when available so the verdict
 * is legible without a DB drill-in.
 */
function MatchInline({
	kept,
	rejected,
	reasons,
	suspiciousIds,
}: {
	kept: ItemSummary[];
	rejected: ItemSummary[];
	reasons?: Record<string, string>;
	/**
	 * Per-itemId map of comps the post-match risk filter flagged. When
	 * provided AND the parent's "show suspicious" toggle is on, flagged
	 * rows in `kept` get a tinted treatment + the fraud reason inline.
	 */
	suspiciousIds?: Record<string, { reason: string; pFraud: number }>;
}) {
	if (kept.length === 0 && rejected.length === 0) return null;
	return (
		<div className="pg-result-matches">
			{kept.length > 0 && (
				<>
					<div className="pg-result-matches-head">
						<span>Kept · {kept.length}</span>
					</div>
					{kept.map((item) => {
						const sus = suspiciousIds?.[item.itemId];
						return (
							<MatchRow
								key={`k-${item.itemId}`}
								item={item}
								bucket="match"
								suspicious={sus}
							/>
						);
					})}
				</>
			)}
			{rejected.length > 0 && (
				<>
					<div className="pg-result-matches-head pg-result-matches-head--reject">
						<span>Rejected · {rejected.length}</span>
					</div>
					{rejected.map((item) => (
						<MatchRow
							key={`r-${item.itemId}`}
							item={item}
							bucket="reject"
							reason={reasons?.[item.itemId]}
						/>
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
	tentative,
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
	/** True when the row's value is computed from the raw (pre-filter)
	 *  pool — CSS targets values inside via
	 *  `.pg-result-facts-row[data-tentative="true"] .pg-result-facts-val`
	 *  and shimmers them so the user sees the digits will sharpen once
	 *  the same-product filter confirms. */
	tentative?: boolean;
}) {
	return (
		<div
			className={`pg-result-facts-row${decisionStart ? " pg-result-facts-decision-start" : ""}`}
			data-tentative={tentative ? "true" : undefined}
		>
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
	reason,
	suspicious,
}: {
	item: ItemSummary;
	bucket: "match" | "reject";
	/** LLM's verdict text, surfaced under the meta line for rejected rows. */
	reason?: string;
	/**
	 * Post-match risk-filter result. When present, the comp was flagged
	 * (Bayesian P_fraud > 0.4) — render with a "suspicious" tint and
	 * surface the reason inline so the reseller sees WHY it would have
	 * been excluded from the median.
	 */
	suspicious?: { reason: string; pFraud: number };
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
		<div
			className={`pg-result-matches-row pg-result-matches-row--${bucket}`}
			data-suspicious={suspicious ? "true" : undefined}
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
					{priceText && <span className="font-mono">${priceText}</span>}
					{modeTag && <span className="pg-result-matches-tag">{modeTag}</span>}
					{item.authenticityGuarantee && <AuthenticityGuaranteeBadge />}
					{suspicious && (
						<span className="pg-result-matches-tag pg-result-matches-tag--suspicious">
							{(suspicious.pFraud * 100).toFixed(0)}% fraud risk
						</span>
					)}
				</div>
				{reason && <p className="pg-result-matches-reason">{reason}</p>}
				{suspicious && !reason && (
					<p className="pg-result-matches-reason pg-result-matches-reason--suspicious">
						Hidden by default — {suspicious.reason}
					</p>
				)}
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
 * eBay Authenticity Guarantee badge — visually mirrors the chip eBay
 * shows on AG-eligible listings (blue scalloped seal with white check
 * + "Authenticity Guarantee" wordmark). Resellers actively look for
 * this on comps because AG listings sell at a premium and ship with
 * lower dispute risk; using eBay's exact visual idiom removes any
 * "is this the same thing?" hesitation.
 *
 * The seal shape is a 12-petal scalloped circle (Lucide-style
 * `BadgeCheck` outline, recolored to eBay's program blue).
 */
function AuthenticityGuaranteeBadge() {
	return (
		<span
			className="pg-result-matches-ag"
			title="eBay Authenticity Guarantee — third-party authenticated before delivery"
		>
			<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
				<path
					d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"
					fill="#0064d2"
				/>
				<path d="m9 12 2 2 4-4" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
			</svg>
			Authenticity Guarantee
		</span>
	);
}

function SellingPaceTag({ market }: { market: MarketStats }) {
	const sd = market.salesPerDay;
	if (sd >= 1) return <span className="pg-result-facts-aside pg-result-facts-aside--good">fast</span>;
	if (sd >= 0.2) return <span className="pg-result-facts-aside">steady</span>;
	if (sd > 0) return <span className="pg-result-facts-aside pg-result-facts-aside--warn">slow</span>;
	return <span className="pg-result-facts-aside">—</span>;
}

/* ----------------------------- footer (cancel/re-run + trace) ----------------------------- */

/**
 * Unified Evaluate footer — same shape as the row drawer's eval footer
 * so users learn one pattern. Left side carries the primary action
 * (Cancel while running, Re-run after complete) plus Copy JSON for the
 * complete-state's API payload. Right side toggles the trace.
 *
 * Trace stays open by default through both states — the user was
 * already watching it run, so collapsing on completion would feel like
 * the table just disappeared.
 */
export function EvalFooter({
	pending,
	payload,
	steps,
	onCancel,
	onRerun,
}: {
	pending: boolean;
	payload: unknown | null;
	steps: Step[];
	onCancel?: () => void;
	onRerun?: () => void;
}) {
	const [open, setOpen] = useState(true);
	const [copied, setCopied] = useState(false);
	async function copy() {
		if (payload == null) return;
		try {
			await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			/* ignore */
		}
	}
	const showCancel = pending && onCancel != null;
	// Re-run shows whenever not pending — matches the drawer's pattern.
	// Errors and cancellations also benefit from a one-click retry.
	const showRerun = !pending && onRerun != null;
	return (
		<div className="pg-result-foot">
			<div className="pg-result-foot-row">
				<div className="pg-result-foot-actions">
					{showCancel && (
						<button type="button" onClick={onCancel} className="pg-result-cancel">
							<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
								<path d="M6 6l12 12M18 6l-12 12" />
							</svg>
							Cancel
						</button>
					)}
					{showRerun && (
						<button type="button" onClick={onRerun} className="pg-result-rerun" title="Re-run">
							<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
								<path d="M14 4v4h-4" />
								<path d="M14 8a6 6 0 1 1-1.6-4.1" />
							</svg>
							Re-run
						</button>
					)}
					{payload != null && (
						<button type="button" onClick={copy} className="pg-result-copy">
							<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
								<rect x="5" y="5" width="9" height="9" rx="1.5" />
								<path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
							</svg>
							{copied ? "Copied" : "Copy JSON"}
						</button>
					)}
				</div>
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
