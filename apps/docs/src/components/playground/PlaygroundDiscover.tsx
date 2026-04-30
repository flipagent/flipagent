/**
 * Discover deals — Overnight pillar.
 *
 * Renders inside a `ComposeCard` (the parent supplies the card frame +
 * tabs). We own the input, filter pills, an optional "More" panel for
 * range/multi-select filters, and the output area (deals + trace).
 *
 * Form state lives here so it survives across Discover ↔ Evaluate tab
 * switches (Dashboard never unmounts the panel — it just hides it).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
	ComposeCard,
	ComposeFilters,
	ComposeInput,
	ComposeOutput,
	ComposeTabs,
	type ComposeTab,
} from "../compose/ComposeCard";
import { FilterPill, type SelectOption } from "../compose/FilterPill";
import { Chips, type ChipOption } from "../ui/Chips";
import { Field } from "../ui/Field";
import {
	cancelComputeJob,
	DISCOVER_STEPS,
	fetchJobStatus,
	friendlyErrorMessage,
	initialSteps,
	reopenDiscover,
	runDiscover,
	runDiscoverMock,
	type DiscoverInputs,
	type DiscoverOutcome,
} from "./pipelines";
import { useResumeSweep } from "./useResumeSweep";
import { QuickStarts, type QuickStart } from "./QuickStarts";
import { useRecentRuns, type RecentRun } from "./recent";
import { RecentRuns } from "./RecentRuns";
import { DealFilters, countActiveDealFilters } from "./DealFilters";
import { DiscoverResult } from "./DiscoverResult";
import type { Step } from "./types";

/* ------------------------------ options ------------------------------ */

type SortValue = "" | "endingSoonest" | "newlyListed" | "pricePlusShippingLowest";
type ConditionKey = "new" | "newother" | "refurb" | "used" | "parts";
type ShipsFrom = "" | "US" | "EU" | "GB" | "DE" | "JP" | "KR" | "CN" | "HK";

const CATEGORY_OPTIONS: ReadonlyArray<SelectOption<string>> = [
	{ value: "", label: "All categories" },
	{ value: "31387", label: "Wristwatches" },
	{ value: "15709", label: "Sneakers / Athletic Shoes" },
	{ value: "139973", label: "Video Games" },
	{ value: "9355", label: "Cell Phones & Smartphones" },
	{ value: "169291", label: "Women's Bags & Handbags" },
	{ value: "183454", label: "CCG / Pokémon Singles" },
	{ value: "11116", label: "Coins" },
	{ value: "11700", label: "Power Tools" },
	{ value: "176985", label: "Vinyl Records" },
];

const CONDITION_CHIPS: ReadonlyArray<ChipOption<ConditionKey> & { ids: string[] }> = [
	{ value: "new", label: "New", ids: ["1000"] },
	{ value: "newother", label: "New Other", ids: ["1500"] },
	{ value: "refurb", label: "Refurbished", ids: ["2010", "2020", "2030", "2040", "2500"] },
	{ value: "used", label: "Used", ids: ["3000"] },
	{ value: "parts", label: "For parts", ids: ["7000"] },
];

const SHIPS_FROM_OPTIONS: ReadonlyArray<SelectOption<ShipsFrom>> = [
	{ value: "", label: "Anywhere" },
	{ value: "US", label: "United States" },
	{ value: "EU", label: "European Union" },
	{ value: "GB", label: "United Kingdom" },
	{ value: "DE", label: "Germany" },
	{ value: "JP", label: "Japan" },
	{ value: "KR", label: "Korea" },
	{ value: "HK", label: "Hong Kong" },
	{ value: "CN", label: "China" },
];

// Maps to eBay Browse's `sort=` param — controls which items get pulled
// into the candidate pool. NOT the discover ranking key (that's always
// recommendedExit.dollarsPerDay, applied after fetch). Default is
// eBay's BestMatch — labelled "Best match" so it doesn't collide with
// the discover-side "best margin / $/day" framing in the result header.
const SORT_OPTIONS: ReadonlyArray<SelectOption<SortValue>> = [
	{ value: "", label: "Best match" },
	{ value: "endingSoonest", label: "Ending soonest" },
	{ value: "newlyListed", label: "Newly listed" },
	{ value: "pricePlusShippingLowest", label: "Lowest price" },
];

const IconBox = (
	<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
		<path d="M2 5l6-3 6 3v6l-6 3-6-3V5z" />
		<path d="M2 5l6 3 6-3M8 8v6" />
	</svg>
);
const IconPin = (
	<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
		<path d="M8 14s5-4.5 5-9a5 5 0 0 0-10 0c0 4.5 5 9 5 9z" />
		<circle cx="8" cy="5" r="1.6" />
	</svg>
);
const IconSort = (
	<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
		<path d="M4 3v10M2 11l2 2 2-2M12 13V3M10 5l2-2 2 2" />
	</svg>
);

/* --------------------------- query persistence --------------------------- */

interface DiscoverQuery {
	categoryId: string;
	q: string;
	priceMin: string;
	priceMax: string;
	conditions: ConditionKey[];
	shipsFrom: ShipsFrom;
	sort: SortValue;
	limit: number;
	// Decision-floor filters — same defaults / option set as Evaluate.
	// Drive the per-deal `evaluate` call's opts so ranking respects the
	// reseller's margin floor + holding window.
	minProfit: string;
	sellWithin: string;
	shipping: string;
}

const EMPTY_QUERY: DiscoverQuery = {
	categoryId: "",
	q: "",
	priceMin: "",
	priceMax: "",
	conditions: [],
	shipsFrom: "",
	sort: "",
	limit: 20,
	minProfit: "10",
	sellWithin: "180",
	shipping: "10",
};

function describe(q: DiscoverQuery): string {
	const parts: string[] = [];
	const c = CATEGORY_OPTIONS.find((o) => o.value === q.categoryId);
	if (c && q.categoryId) parts.push(c.label);
	if (q.q) parts.push(`"${q.q}"`);
	if (q.priceMin || q.priceMax) parts.push(`$${q.priceMin || "0"}–${q.priceMax || "∞"}`);
	if (q.conditions.length > 0)
		parts.push(q.conditions.map((k) => CONDITION_CHIPS.find((c) => c.value === k)?.label ?? k).join("/"));
	if (q.shipsFrom) parts.push(SHIPS_FROM_OPTIONS.find((s) => s.value === q.shipsFrom)?.label ?? q.shipsFrom);
	if (q.sort) parts.push(SORT_OPTIONS.find((s) => s.value === q.sort)?.label ?? q.sort);
	return parts.length > 0 ? parts.join(" · ") : "All listings";
}

/* ----------------------------- component ----------------------------- */

export function PlaygroundDiscover<TabId extends string = "discover" | "evaluate">({
	tabsProps,
	onEvaluate: _onEvaluate,
	mockMode = false,
}: {
	tabsProps: {
		tabs: ReadonlyArray<ComposeTab<TabId>>;
		active: TabId;
		onChange: (next: TabId) => void;
	};
	/** Reserved for a future "Evaluate this deal" jump from a row. Currently
	 * unused — clicking a deal expands inline rather than swapping tabs. */
	onEvaluate: (itemId: string) => void;
	/** When true, run a canned pipeline against in-memory fixtures (logged-out hero). */
	mockMode?: boolean;
}) {
	const [query, setQuery] = useState<DiscoverQuery>(EMPTY_QUERY);
	const [moreOpen, setMoreOpen] = useState(false);
	const [steps, setSteps] = useState<Step[]>(initialSteps(DISCOVER_STEPS));
	const [pending, setPending] = useState(false);
	// Partial outcome — clusters[] / deals[] fill in progressively as
	// each cluster.ready event lands, then the final `done` replaces
	// with the canonical full result. Keeps the table responsive: the
	// first SKU's row appears within seconds, not after the slowest
	// cluster finishes.
	const [outcome, setOutcome] = useState<Partial<DiscoverOutcome>>({});
	const [hasRun, setHasRun] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	// True iff the current `query` came verbatim from a QUICKSTART preset
	// (no user edits). When false in mockMode, Run redirects to /signup
	// instead of showing canned mock data — the canned response doesn't
	// reflect what the visitor typed, so running it would be misleading.
	const [fromPreset, setFromPreset] = useState(false);
	// Selected cluster index drives the detail drawer in DiscoverResult.
	// Reset on every fresh run so a stale index from a previous query
	// doesn't open a now-different cluster's drawer.
	const [selectedClusterIdx, setSelectedClusterIdx] = useState<number | null>(null);
	const recent = useRecentRuns<DiscoverQuery>("discover");
	// Active job + abort controller — see PlaygroundEvaluate for the model.
	const jobIdRef = useRef<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	useEffect(() => {
		return () => {
			abortRef.current?.abort();
		};
	}, []);

	useResumeSweep("discover", recent);

	function cancel() {
		const id = jobIdRef.current;
		if (id) void cancelComputeJob("discover", id);
		abortRef.current?.abort();
	}

	const moreActive = useMemo(() => {
		let n = 0;
		if (query.priceMin || query.priceMax) n++;
		if (query.conditions.length > 0) n++;
		n += countActiveDealFilters({
			minProfit: query.minProfit,
			sellWithin: query.sellWithin,
			shipping: query.shipping,
		});
		return n;
	}, [query.priceMin, query.priceMax, query.conditions, query.minProfit, query.sellWithin, query.shipping]);

	// TODO(scrape category browse): once `/v1/buy/browse/item_summary/search` accepts
	// category-only queries (blocked on a parser for the new browse-layout
	// DOM — see BrowseSearchQuery in @flipagent/types), relax this back to
	// `q || categoryId`. Today the backend rejects category-only with a
	// 400 for q, so we keep the Run button disabled until the user types.
	const canRun = query.q.trim().length > 0 && !pending;

	function patch<K extends keyof DiscoverQuery>(k: K, v: DiscoverQuery[K]) {
		setQuery((prev) => ({ ...prev, [k]: v }));
		// Any user edit invalidates the preset signature — the canned mock
		// no longer matches the visible query.
		setFromPreset(false);
	}

	function applyPreset(preset: Partial<DiscoverQuery>) {
		setQuery({ ...EMPTY_QUERY, ...preset });
		setFromPreset(true);
	}

	async function execute(target: DiscoverQuery = query) {
		// Logged-out + custom query → redirect to sign-in. The canned mock
		// is fixed-content (same Watches/Pokémon/Jordan clusters regardless
		// of input) so running it against arbitrary text would be
		// misleading. Presets keep mock-running so the demo loop works.
		if (mockMode && !fromPreset) {
			const ret = window.location.pathname + window.location.search;
			window.location.href = `/signup/?return=${encodeURIComponent(ret)}`;
			return;
		}
		setHasRun(true);
		setOutcome({});
		setErr(null);
		setSteps(initialSteps(DISCOVER_STEPS));
		setPending(true);
		setSelectedClusterIdx(null);
		const recentBase = {
			id: JSON.stringify(target),
			mode: "discover" as const,
			label: describe(target),
			query: target,
		};
		recent.add({ ...recentBase, timestamp: Date.now(), status: "in_progress" });
		jobIdRef.current = null;
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		try {
			const conditionIds = target.conditions.flatMap(
				(k) => CONDITION_CHIPS.find((c) => c.value === k)?.ids ?? [],
			);
			const inputs: DiscoverInputs = {
				q: target.q.trim(),
				categoryId: target.categoryId || undefined,
				minPriceCents: target.priceMin ? Math.round(Number.parseFloat(target.priceMin) * 100) : undefined,
				maxPriceCents: target.priceMax ? Math.round(Number.parseFloat(target.priceMax) * 100) : undefined,
				conditionIds: conditionIds.length > 0 ? conditionIds : undefined,
				shipsFrom: target.shipsFrom || undefined,
				sort: target.sort || undefined,
				limit: target.limit,
				minNetCents: Math.round(Number.parseFloat(target.minProfit) * 100),
				maxDaysToSell: Number.parseInt(target.sellWithin, 10),
				outboundShippingCents: Math.round(Number.parseFloat(target.shipping) * 100),
			};
			const runner = mockMode ? runDiscoverMock : runDiscover;
			const result = await runner(
				inputs,
				{
					onJobCreated: (id) => {
						jobIdRef.current = id;
						// Persist jobId on the in-progress placeholder so a
						// reload-then-click can resume via /jobs/{id}/stream.
						recent.update(recentBase.id, { jobId: id });
					},
					onStep: (key, p) =>
						setSteps((prev) => {
							const idx = prev.findIndex((s) => s.key === key);
							if (idx >= 0) return prev.map((s, i) => (i === idx ? { ...s, ...p } : s));
							// Dynamic step (e.g., per-cluster `search.sold.<n>` child) —
							// append so the trace shows it under its parent.
							return [...prev, { key, label: p.label ?? key, status: p.status ?? "pending", ...p }];
						}),
					onPartial: (patch) => setOutcome((prev) => ({ ...prev, ...patch })),
				},
				controller.signal,
			);
			if (result.kind === "success") {
				setOutcome(result.value);
			} else if (result.kind === "failed") {
				// Stream-level failure — banner + freeze running steps in
				// one place so we don't leave Search market spinning while
				// only Evaluate shows red.
				const friendly = friendlyErrorMessage(result.message, result.code);
				setErr(friendly);
				setSteps((prev) =>
					prev.map((s) => (s.status === "running" ? { ...s, status: "error", error: friendly } : s)),
				);
			} else if (result.kind === "cancelled") {
				// User cancelled — flip every still-running step to skipped
				// so spinners stop. Without this, the trace keeps animating
				// even though pending is false and the worker is gone.
				setSteps((prev) =>
					prev.map((s) => (s.status === "running" ? { ...s, status: "skipped" } : s)),
				);
			}
			const finalStatus =
				result.kind === "success" ? "success" : result.kind === "cancelled" ? "cancelled" : "failure";
			recent.add({
				...recentBase,
				timestamp: Date.now(),
				status: finalStatus,
				jobId: jobIdRef.current ?? undefined,
			});
		} catch (caught) {
			const message = caught instanceof Error ? caught.message : String(caught);
			setErr(`Something went wrong: ${message}`);
			setSteps((prev) =>
				prev.map((s) => (s.status === "running" ? { ...s, status: "error", error: message } : s)),
			);
			recent.add({ ...recentBase, timestamp: Date.now(), status: "failure", jobId: jobIdRef.current ?? undefined });
		} finally {
			setPending(false);
		}
	}

	/**
	 * Click handler for a Recent row. Replays the saved query into the
	 * form and reopens the saved job — `/jobs/{id}/stream` covers
	 * in_progress / completed / failed / cancelled in one shape. Legacy
	 * entries without `jobId` fall back to a fresh run.
	 */
	function reopen(rec: RecentRun<DiscoverQuery>) {
		setQuery(rec.query);
		if (!rec.jobId) {
			void execute(rec.query);
			return;
		}
		void reopenSavedJob(rec);
	}

	async function reopenSavedJob(rec: RecentRun<DiscoverQuery>) {
		const id = rec.jobId;
		if (!id) return;
		// Pre-flight — confirm the job row still exists. If the api key
		// rotated or the row was reaped, don't flip Recent's saved
		// status; the historical run was still real.
		const exists = await fetchJobStatus("discover", id);
		if (!exists) {
			setErr("This run is no longer available — hit Run to re-execute with the same query.");
			setHasRun(false);
			return;
		}
		setHasRun(true);
		setOutcome({});
		setErr(null);
		setSteps(initialSteps(DISCOVER_STEPS));
		setPending(true);
		setSelectedClusterIdx(null);
		jobIdRef.current = id;
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		try {
			const result = await reopenDiscover(
				id,
				{
					onStep: (key, p) =>
						setSteps((prev) => {
							const idx = prev.findIndex((s) => s.key === key);
							if (idx >= 0) return prev.map((s, i) => (i === idx ? { ...s, ...p } : s));
							return [...prev, { key, label: p.label ?? key, status: p.status ?? "pending", ...p }];
						}),
					onPartial: (patch) => setOutcome((prev) => ({ ...prev, ...patch })),
				},
				controller.signal,
			);
			if (result.kind === "success") setOutcome(result.value);
			else if (result.kind === "failed") {
				const friendly = friendlyErrorMessage(result.message, result.code);
				setErr(friendly);
				setSteps((prev) =>
					prev.map((s) => (s.status === "running" ? { ...s, status: "error", error: friendly } : s)),
				);
			} else if (result.kind === "cancelled") {
				setSteps((prev) =>
					prev.map((s) => (s.status === "running" ? { ...s, status: "skipped" } : s)),
				);
			}
			const finalStatus =
				result.kind === "success" ? "success" : result.kind === "cancelled" ? "cancelled" : "failure";
			if (rec.status !== finalStatus) recent.update(rec.id, { status: finalStatus });
		} catch (caught) {
			const message = caught instanceof Error ? caught.message : String(caught);
			setErr(`Something went wrong: ${message}`);
			setSteps((prev) =>
				prev.map((s) => (s.status === "running" ? { ...s, status: "error", error: message } : s)),
			);
		} finally {
			setPending(false);
		}
	}

	// Broad-keyword presets so each one fans out to multiple SKUs — that's
	// where Discover's same-product clustering + cross-cluster ranking
	// actually shows its work. A single-SKU preset collapses to one
	// cluster, hiding the very thing the demo is supposed to communicate.
	// Each preset MUST set `q` — backend rejects category-only queries
	// today (see BrowseSearchQuery TODO).
	const QUICKSTARTS: ReadonlyArray<QuickStart> = [
		{ label: "Watches under $300", apply: () => applyPreset({ q: "watch", categoryId: "31387", priceMax: "300" }) },
		{ label: "Jordan over $200", apply: () => applyPreset({ q: "air jordan", categoryId: "15709", priceMin: "200" }) },
		{ label: "Pokémon Charizard", apply: () => applyPreset({ q: "charizard 1st edition", categoryId: "183454" }) },
	];

	return (
		<>
			<ComposeCard>
				<ComposeTabs tabs={tabsProps.tabs} active={tabsProps.active} onChange={tabsProps.onChange} />
				<ComposeInput
					value={query.q}
					onChange={(v) => patch("q", v)}
					onRun={() => execute()}
					onCancel={cancel}
					disabled={!canRun}
					pending={pending}
					placeholder='What are you looking for? — e.g. "watches under $300 ending soon"'
				/>

			<ComposeFilters>
				<FilterPill
					value={query.categoryId}
					options={CATEGORY_OPTIONS}
					onChange={(v) => patch("categoryId", v)}
					icon={IconBox}
					label="Category"
				/>
				<FilterPill
					value={query.shipsFrom}
					options={SHIPS_FROM_OPTIONS}
					onChange={(v) => patch("shipsFrom", v)}
					icon={IconPin}
					label="Ships from"
				/>
				<FilterPill
					value={query.sort}
					options={SORT_OPTIONS}
					onChange={(v) => patch("sort", v)}
					icon={IconSort}
					label="Sort"
				/>
				<button
					type="button"
					onClick={() => setMoreOpen((o) => !o)}
					aria-expanded={moreOpen}
					className={`flex items-center gap-1.5 h-7 px-2.5 rounded-[6px] text-[12px] border transition-colors duration-100 cursor-pointer ${
						moreActive > 0
							? "border-[var(--brand)] text-[var(--brand)] bg-[var(--brand-soft)]"
							: "border-[var(--border-faint)] text-[var(--text-3)] hover:text-[var(--text)] hover:border-[var(--border)]"
					}`}
				>
					<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
						<circle cx="4" cy="4" r="1.4" />
						<path d="M7 4h6" />
						<circle cx="11" cy="8" r="1.4" />
						<path d="M3 8h5M13 8h0" />
						<circle cx="6" cy="12" r="1.4" />
						<path d="M3 12h1M9 12h4" />
					</svg>
					More {moreActive > 0 ? `· ${moreActive}` : ""}
				</button>
			</ComposeFilters>

			{moreOpen && (
				<div className="px-5 py-4 border-b border-[var(--border-faint)] bg-[color:var(--bg-soft)]/40 max-sm:px-4">
					<div className="flex flex-col gap-3">
						<Field label="Price ($)">
							{() => (
								<div className="flex items-center gap-2">
									<input
										type="number"
										min={0}
										step={1}
										value={query.priceMin}
										onChange={(e) => patch("priceMin", e.target.value)}
										placeholder="min"
										className="flex-1 max-w-[140px] text-[13px] px-3 py-1.5 border border-[var(--border)] rounded-[6px] bg-[var(--surface)] text-[var(--text)] outline-none focus:border-[var(--text-3)]"
									/>
									<span className="text-[12px] text-[var(--text-3)]">to</span>
									<input
										type="number"
										min={0}
										step={1}
										value={query.priceMax}
										onChange={(e) => patch("priceMax", e.target.value)}
										placeholder="max"
										className="flex-1 max-w-[140px] text-[13px] px-3 py-1.5 border border-[var(--border)] rounded-[6px] bg-[var(--surface)] text-[var(--text)] outline-none focus:border-[var(--text-3)]"
									/>
								</div>
							)}
						</Field>
						<Field label="Condition">
							{(labelId) => (
								<Chips
									value={query.conditions}
									options={CONDITION_CHIPS}
									onChange={(v) => patch("conditions", v)}
									aria-labelledby={labelId}
								/>
							)}
						</Field>
						<Field label="Limit">
							{() => (
								<input
									type="number"
									min={1}
									max={50}
									value={query.limit}
									onChange={(e) => patch("limit", Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
									className="w-[100px] text-[13px] px-3 py-1.5 border border-[var(--border)] rounded-[6px] bg-[var(--surface)] text-[var(--text)] outline-none focus:border-[var(--text-3)]"
								/>
							)}
						</Field>
						{/* Decision-floor filters — shared with Evaluate, same defaults.
						    Min profit / Sell within / Shipping flow into each per-
						    candidate evaluate() call so ranking respects the floor. */}
						<DealFilters
							value={{ minProfit: query.minProfit, sellWithin: query.sellWithin, shipping: query.shipping }}
							onChange={(next) =>
								setQuery((prev) => ({
									...prev,
									minProfit: next.minProfit,
									sellWithin: next.sellWithin,
									shipping: next.shipping,
								}))
							}
						/>
					</div>
				</div>
			)}

			{(hasRun || err) && (
				<ComposeOutput>
					{err && <p className="text-[13px] text-[#c0392b] mb-3">{err}</p>}
					{hasRun && !err && (
						<DiscoverResult
							outcome={outcome}
							steps={steps}
							pending={pending}
							hasRun={hasRun}
							sellWithinDays={Number.parseInt(query.sellWithin, 10) || undefined}
							selectedClusterIdx={selectedClusterIdx}
							onSelectCluster={setSelectedClusterIdx}
						/>
					)}
				</ComposeOutput>
			)}
			</ComposeCard>

			<div className="max-w-[760px] mx-auto mt-4">
				<QuickStarts items={QUICKSTARTS} />
				<RecentRuns runs={recent.runs} onPick={reopen} onClear={recent.clear} />
			</div>
		</>
	);
}
