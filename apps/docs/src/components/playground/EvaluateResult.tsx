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
import { PriceHistogram } from "./PriceHistogram";
import { Trace } from "./Trace";
import type { EvaluateOutcome } from "./pipelines";
import type { ItemDetail, ItemSummary, MarketStats, Step } from "./types";

const RATING_TONE: Record<string, string> = {
	buy: "good",
	pass: "warn",
	skip: "neutral",
};

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
	const candidatePriceCents = outcome.detail?.price
		? Math.round(Number.parseFloat(outcome.detail.price.value) * 100)
		: null;
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
			{outcome.detail ? <ItemHero item={outcome.detail} /> : <ItemHeroSkeleton />}

			{outcome.soldPool ? (() => {
				// Once match completes, narrow both chart series to same-
				// product items. A listing that appears in BOTH pools (e.g.
				// recently-sold-and-still-active) belongs in BOTH series —
				// its sold price and active ask are distinct data points.
				let soldSeries: ItemSummary[] = outcome.soldPool;
				let activeSeries: ItemSummary[] = outcome.activePool ?? [];
				if (outcome.buckets) {
					const sIds = new Set(outcome.soldPool.map((i) => i.itemId));
					const aIds = new Set((outcome.activePool ?? []).map((i) => i.itemId));
					soldSeries = outcome.buckets.match.filter((m) => sIds.has(m.item.itemId)).map((m) => m.item);
					activeSeries = outcome.buckets.match.filter((m) => aIds.has(m.item.itemId)).map((m) => m.item);
				}
				return (
					<PriceHistogram
						sold={soldSeries}
						active={activeSeries}
						candidatePriceCents={candidatePriceCents}
					/>
				);
			})() : pending ? (
				<ChartSkeleton />
			) : null}

			<Facts outcome={outcome} pending={pending} />

			{(outcome.verdict || pending) && (
				<Recommendation outcome={outcome} sellWithinDays={sellWithinDays} pending={pending} />
			)}

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

function isComplete(o: Partial<EvaluateOutcome>): boolean {
	return !!(o.detail && o.soldPool && o.activePool && o.buckets && o.thesis && o.verdict);
}

/* ----------------------------- item hero ----------------------------- */

function ItemHeroSkeleton() {
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

function ChartSkeleton() {
	return <div className="pg-result-chart-skel pg-result-skel" />;
}

function ItemHero({ item }: { item: ItemDetail }) {
	const img = item.image?.imageUrl;
	return (
		<a
			href={item.itemWebUrl}
			target="_blank"
			rel="noopener noreferrer"
			className="pg-result-hero"
		>
			<div className="pg-result-hero-thumb">
				{img ? <img src={img} alt="" loading="lazy" /> : <span aria-hidden="true">·</span>}
			</div>
			<div className="pg-result-hero-body">
				<div className="pg-result-hero-title">{item.title}</div>
				<div className="pg-result-hero-meta">
					{item.condition && <span>{item.condition}</span>}
					{item.brand && <span>{item.brand}</span>}
					{item.price && <span className="font-mono">${item.price.value}</span>}
				</div>
			</div>
			<svg
				className="pg-result-hero-link"
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
	);
}

/* ------------------------------ facts ------------------------------ */

function Facts({ outcome, pending }: { outcome: Partial<EvaluateOutcome>; pending: boolean }) {
	const [soldOpen, setSoldOpen] = useState(false);
	const [activeOpen, setActiveOpen] = useState(false);
	const [matchedOpen, setMatchedOpen] = useState(true);
	const [rejectedOpen, setRejectedOpen] = useState(true);
	const market = outcome.thesis?.market;
	const verdict = outcome.verdict;
	const buckets = outcome.buckets;
	const soldPool = outcome.soldPool;
	const activePool = outcome.activePool;
	// The pipeline feeds match() with sold + active combined (deduped to
	// save LLM tokens). On display, route each verdict to BOTH cohorts it
	// originally appeared in — a relisted-and-recently-sold listing
	// genuinely belongs in both Sold (price truth) and Active (live
	// competition). The histogram's lastSoldPrice/price field separation
	// keeps the math correct without us splitting the match call.
	const soldIdSet = soldPool ? new Set(soldPool.map((i) => i.itemId)) : null;
	const activeIdSet = activePool ? new Set(activePool.map((i) => i.itemId)) : null;
	const inSold = (id: string) => soldIdSet?.has(id) ?? false;
	const inActive = (id: string) => activeIdSet?.has(id) ?? false;
	const soldMatches = buckets ? buckets.match.filter((m) => inSold(m.item.itemId)) : [];
	const soldRejects = buckets ? buckets.reject.filter((m) => inSold(m.item.itemId)) : [];
	const activeMatches = buckets ? buckets.match.filter((m) => inActive(m.item.itemId)) : [];
	const activeRejects = buckets ? buckets.reject.filter((m) => inActive(m.item.itemId)) : [];
	// Active asks stats — computed client-side off matched-active items.
	// `price.value` is the asking price for FIXED_PRICE; for AUCTION it's
	// the starting/current price (close enough for "asks distribution").
	const askCents = activeMatches
		.map((m) => (m.item.price ? Math.round(Number.parseFloat(m.item.price.value) * 100) : null))
		.filter((c): c is number => c != null && Number.isFinite(c));
	const lowestAskCents = askCents.length > 0 ? Math.min(...askCents) : null;
	const highestAskCents = askCents.length > 0 ? Math.max(...askCents) : null;
	// Active bids — only AUCTION items with a current bid count for a
	// "what buyers are actually willing to pay" data point.
	const auctionBids = activeMatches
		.map((m) => {
			const opts = m.item.buyingOptions ?? [];
			if (!opts.includes("AUCTION")) return null;
			const bp = m.item.currentBidPrice;
			if (!bp) return null;
			const cents = Math.round(Number.parseFloat(bp.value) * 100);
			return Number.isFinite(cents) ? cents : null;
		})
		.filter((c): c is number => c != null);
	const highestBidCents = auctionBids.length > 0 ? Math.max(...auctionBids) : null;

	const candCents = outcome.detail?.price
		? Math.round(Number.parseFloat(outcome.detail.price.value) * 100)
		: null;
	const deltaSold = candCents != null && market?.medianCents ? candCents - market.medianCents : null;
	const deltaAsk = candCents != null && lowestAskCents != null ? candCents - lowestAskCents : null;

	const lowSample = market != null && market.nObservations > 0 && market.nObservations < 5;

	return (
		<>
		<dl className="pg-result-facts">
			{/* Sold — what people actually paid. The strongest market signal. */}
			<Row label="Sold for">
				{market ? (
					<>
						<span className="pg-result-facts-val">{fmtUsd(market.medianCents)}</span>
						<span className="pg-result-facts-aside">
							{fmtUsdRound(market.p25Cents)}–{fmtUsdRound(market.p75Cents)} range
						</span>
						{soldPool && (
							<span className="pg-result-facts-aside">
								· {buckets ? soldMatches.length : <Skel w={14} h={12} />} of {soldPool.length}
							</span>
						)}
						{lowSample && (
							<span className="pg-result-facts-warn">limited data (n={market.nObservations})</span>
						)}
						{buckets && soldPool && soldPool.length > 0 && (
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
					<Skel w={140} />
				)}
			</Row>
			{soldOpen && buckets && soldPool && soldPool.length > 0 && (
				<MatchInline
					matches={soldMatches}
					rejects={soldRejects}
					matchedOpen={matchedOpen}
					rejectedOpen={rejectedOpen}
					setMatchedOpen={setMatchedOpen}
					setRejectedOpen={setRejectedOpen}
				/>
			)}

			{/* Velocity — selling pace + typical wait merged into one row.
			    Reseller cares: how often, and how long until I sell mine. */}
			<Row label="Velocity">
				{market ? (
					<>
						<span className="pg-result-facts-val">{market.salesPerDay.toFixed(2)} / day</span>
						<SellingPaceTag market={market} />
						{market.meanDaysToSell != null && (
							<span className="pg-result-facts-aside">~{Math.round(market.meanDaysToSell)}d to sell</span>
						)}
					</>
				) : (
					<Skel w={130} />
				)}
			</Row>

			{/* Active asks — what competitors are charging right now. */}
			<Row label="Active asks">
				{activePool ? (
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
						) : buckets ? (
							<span className="pg-result-facts-aside">none matched</span>
						) : (
							<Skel w={120} />
						)}
						<span className="pg-result-facts-aside">
							· {buckets ? activeMatches.length : <Skel w={14} h={12} />} of {activePool.length}
						</span>
						{buckets && activePool.length > 0 && (
							<button
								type="button"
								onClick={() => setActiveOpen((o) => !o)}
								className="pg-result-facts-toggle"
							>
								{activeOpen ? "Hide" : "View"}
							</button>
						)}
					</>
				) : (
					<Skel w={140} />
				)}
			</Row>
			{activeOpen && buckets && activePool && activePool.length > 0 && (
				<MatchInline
					matches={activeMatches}
					rejects={activeRejects}
					matchedOpen={matchedOpen}
					rejectedOpen={rejectedOpen}
					setMatchedOpen={setMatchedOpen}
					setRejectedOpen={setRejectedOpen}
				/>
			)}

			{/* Active bids — only when at least one matched auction has a
			    real bid. Tells you what buyers are actually willing to pay
			    today, which the asks number can't. */}
			{highestBidCents != null && (
				<Row label="Active bids">
					<span className="pg-result-facts-val">{fmtUsdRound(highestBidCents)}</span>
					<span className="pg-result-facts-aside">highest current bid</span>
					<span className="pg-result-facts-aside">· {auctionBids.length} bidding</span>
				</Row>
			)}

			{/* This listing's position vs market. Two deltas — vs sold
			    median (true value) and vs lowest active ask (competition). */}
			<Row label="Listed at">
				{outcome.detail ? (
					<>
						<span className="pg-result-facts-val">{fmtUsd(candCents)}</span>
						{deltaSold != null && Math.abs(deltaSold) >= 100 && (
							<span
								className={`pg-result-facts-aside${
									deltaSold > 0 ? " pg-result-facts-aside--warn" : " pg-result-facts-aside--good"
								}`}
							>
								{deltaSold > 0 ? "+" : "−"}${Math.abs(Math.round(deltaSold / 100))}{" "}
								vs sold
							</span>
						)}
						{deltaAsk != null && Math.abs(deltaAsk) >= 100 && (
							<span
								className={`pg-result-facts-aside${
									deltaAsk > 0 ? " pg-result-facts-aside--warn" : " pg-result-facts-aside--good"
								}`}
							>
								· {deltaAsk > 0 ? "+" : "−"}${Math.abs(Math.round(deltaAsk / 100))}{" "}
								vs lowest ask
							</span>
						)}
					</>
				) : (
					<Skel w={80} />
				)}
			</Row>

			{/* Conclusion — single recommended exit row. The price is the
			    optimal-yield list price under hazard model + competition
			    factor + active-mean blend; the aside summarises expected
			    days, net (after fees, ship, AND buy cost), and $/day. When
			    net is negative, the row colours warn and the wording flips
			    to "least-loss exit" — there's no profitable flip but the
			    reseller still gets the actionable "if you must sell, do it
			    here" answer. Verdict above already says SKIP. */}
			<Row label="List at" final>
				{verdict?.recommendedExit ? (
					<>
						<span
							className={`pg-result-facts-val${
								verdict.recommendedExit.netCents < 0
									? " pg-result-facts-val--warn"
									: verdict.recommendedExit.netCents > 0
										? " pg-result-facts-val--good"
										: ""
							}`}
						>
							{fmtUsdRound(verdict.recommendedExit.listPriceCents)}
						</span>
						<span className="pg-result-facts-aside">
							→ ~{Math.round(verdict.recommendedExit.expectedDays)}d ·{" "}
							{verdict.recommendedExit.netCents >= 0 ? "+" : "−"}
							{fmtUsdRound(Math.abs(verdict.recommendedExit.netCents))} net ·{" "}
							{fmtUsdRound(verdict.recommendedExit.dollarsPerDay)}/day
							{verdict.recommendedExit.netCents < 0 && " · least-loss exit"}
						</span>
					</>
				) : verdict ? (
					// True null path — model couldn't run (no duration data,
					// σ=0, etc). Surface what we have so the row isn't empty.
					<>
						<span
							className={`pg-result-facts-val${
								(verdict.netCents ?? 0) < 0
									? " pg-result-facts-val--warn"
									: (verdict.netCents ?? 0) > 0
										? " pg-result-facts-val--good"
										: ""
							}`}
						>
							{fmtUsdRound(verdict.netCents)}
						</span>
						<span className="pg-result-facts-aside">
							net at typical exit · time-to-sell unknown
						</span>
					</>
				) : (
					<Skel w={120} />
				)}
			</Row>
		</dl>
		</>
	);
}

function MatchInline({
	matches,
	rejects,
	matchedOpen,
	rejectedOpen,
	setMatchedOpen,
	setRejectedOpen,
}: {
	matches: { item: ItemSummary; reason: string }[];
	rejects: { item: ItemSummary; reason: string }[];
	matchedOpen: boolean;
	rejectedOpen: boolean;
	setMatchedOpen: (fn: (o: boolean) => boolean) => void;
	setRejectedOpen: (fn: (o: boolean) => boolean) => void;
}) {
	if (matches.length === 0 && rejects.length === 0) return null;
	return (
		<div className="pg-result-matches">
			{matches.length > 0 && (
				<>
					<button
						type="button"
						className="pg-result-matches-head"
						onClick={() => setMatchedOpen((o) => !o)}
						aria-expanded={matchedOpen}
					>
						<Caret open={matchedOpen} />
						<span>Matched · {matches.length}</span>
					</button>
					{matchedOpen &&
						matches.map((m) => (
							<MatchRow key={m.item.itemId} item={m.item} reason={m.reason} bucket="match" />
						))}
				</>
			)}
			{rejects.length > 0 && (
				<>
					<button
						type="button"
						className="pg-result-matches-head pg-result-matches-head--reject"
						onClick={() => setRejectedOpen((o) => !o)}
						aria-expanded={rejectedOpen}
					>
						<Caret open={rejectedOpen} />
						<span>Rejected · {rejects.length}</span>
					</button>
					{rejectedOpen &&
						rejects.map((m) => (
							<MatchRow key={m.item.itemId} item={m.item} reason={m.reason} bucket="reject" />
						))}
				</>
			)}
		</div>
	);
}

/** Static gray placeholder while a row's data is in flight. No animation —
 * the spinner on the Run button + spinner on the running trace step
 * already signal progress; movement here would compete. */
function Skel({ w = 80, h = 14 }: { w?: number; h?: number }) {
	return (
		<span
			aria-hidden="true"
			className="pg-result-skel"
			style={{ width: `${w}px`, height: `${h}px` }}
		/>
	);
}

function Row({ label, children, final }: { label: string; children: React.ReactNode; final?: boolean }) {
	return (
		<div className={final ? "pg-result-facts-final" : undefined}>
			<dt>{label}</dt>
			<dd>{children}</dd>
		</div>
	);
}

function Caret({ open }: { open: boolean }) {
	return (
		<svg
			width="9"
			height="9"
			viewBox="0 0 16 16"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
			className="pg-result-matches-caret"
			data-open={open ? "true" : "false"}
			aria-hidden="true"
		>
			<path d="M5 4l4 4-4 4" />
		</svg>
	);
}

function MatchRow({
	item,
	reason,
	bucket,
}: {
	item: ItemSummary;
	reason: string;
	bucket: "match" | "reject";
}) {
	return (
		<a
			href={item.itemWebUrl}
			target="_blank"
			rel="noopener noreferrer"
			className={`pg-result-matches-row pg-result-matches-row--${bucket}`}
		>
			<div className="pg-result-matches-thumb">
				{item.image?.imageUrl ? (
					<img src={item.image.imageUrl} alt="" loading="lazy" />
				) : (
					<span aria-hidden="true">·</span>
				)}
			</div>
			<div className="pg-result-matches-body">
				<div className="pg-result-matches-title">{item.title}</div>
				<div className="pg-result-matches-meta">
					{item.condition && <span>{item.condition}</span>}
					{item.lastSoldPrice && <span className="font-mono">${item.lastSoldPrice.value}</span>}
				</div>
				<div className="pg-result-matches-reason">{reason}</div>
			</div>
		</a>
	);
}

function SellingPaceTag({ market }: { market: MarketStats }) {
	const sd = market.salesPerDay;
	if (sd >= 1) return <span className="pg-result-facts-aside pg-result-facts-aside--good">fast</span>;
	if (sd >= 0.2) return <span className="pg-result-facts-aside">steady</span>;
	if (sd > 0) return <span className="pg-result-facts-aside pg-result-facts-aside--warn">slow</span>;
	return <span className="pg-result-facts-aside">—</span>;
}

/* --------------------------- recommendation --------------------------- */

function Recommendation({
	outcome,
	sellWithinDays,
	pending,
}: {
	outcome: Partial<EvaluateOutcome>;
	sellWithinDays?: number;
	pending: boolean;
}) {
	const verdict = outcome.verdict;
	const tone = RATING_TONE[verdict?.rating ?? ""] ?? "neutral";

	const wait = outcome.thesis?.market.meanDaysToSell;
	const slowWarning =
		verdict && sellWithinDays && sellWithinDays > 0 && wait != null && wait > sellWithinDays
			? `Heads up: typical wait is ~${Math.round(wait)} days — beyond your ${sellWithinDays}-day window.`
			: null;

	return (
		<section className="pg-result-rec">
			<div className="pg-result-rec-line-prim">
				<span className="pg-result-rec-prefix">Recommend</span>
				{verdict ? (
					<span className={`pg-result-rec-rating pg-result-rec-rating--${tone}`}>
						{(verdict.rating ?? "—").toUpperCase()}
					</span>
				) : pending ? (
					<Skel w={60} h={14} />
				) : (
					<span className="pg-result-rec-rating">—</span>
				)}
			</div>
			{slowWarning && <p className="pg-result-rec-line pg-result-rec-warn">{slowWarning}</p>}
		</section>
	);
}

/* ----------------------------- footer (copy + trace) ----------------------------- */

function Footer({ payload, steps }: { payload: unknown; steps: Step[] }) {
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
