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

import { motion } from "motion/react";
import { useMemo, useState } from "react";
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
	DISCOVER_STEPS,
	initialSteps,
	runDiscover,
	runDiscoverMock,
	type DiscoverInputs,
	type DiscoverOutcome,
} from "./pipelines";
import { QuickStarts, type QuickStart } from "./QuickStarts";
import { useRecentRuns, type RecentRun } from "./recent";
import { RecentRuns } from "./RecentRuns";
import { Trace } from "./Trace";
import type { ItemSummary, RankedDeal, Step } from "./types";

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

const SORT_OPTIONS: ReadonlyArray<SelectOption<SortValue>> = [
	{ value: "", label: "Best margin" },
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
	onEvaluate,
	mockMode = false,
}: {
	tabsProps: {
		tabs: ReadonlyArray<ComposeTab<TabId>>;
		active: TabId;
		onChange: (next: TabId) => void;
	};
	onEvaluate: (itemId: string) => void;
	/** When true, run a canned pipeline against in-memory fixtures (logged-out hero). */
	mockMode?: boolean;
}) {
	const [query, setQuery] = useState<DiscoverQuery>(EMPTY_QUERY);
	const [moreOpen, setMoreOpen] = useState(false);
	const [steps, setSteps] = useState<Step[]>(initialSteps(DISCOVER_STEPS));
	const [pending, setPending] = useState(false);
	const [outcome, setOutcome] = useState<DiscoverOutcome | null>(null);
	const [hasRun, setHasRun] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const recent = useRecentRuns<DiscoverQuery>("discover");

	const moreActive = useMemo(() => {
		let n = 0;
		if (query.priceMin || query.priceMax) n++;
		if (query.conditions.length > 0) n++;
		return n;
	}, [query.priceMin, query.priceMax, query.conditions]);

	// TODO(scrape category browse): once `/v1/listings/search` accepts
	// category-only queries (blocked on a parser for the new browse-layout
	// DOM — see BrowseSearchQuery in @flipagent/types), relax this back to
	// `q || categoryId`. Today the backend rejects category-only with a
	// 400 for q, so we keep the Run button disabled until the user types.
	const canRun = query.q.trim().length > 0 && !pending;

	function patch<K extends keyof DiscoverQuery>(k: K, v: DiscoverQuery[K]) {
		setQuery((prev) => ({ ...prev, [k]: v }));
	}

	function applyPreset(preset: Partial<DiscoverQuery>) {
		setQuery({ ...EMPTY_QUERY, ...preset });
	}

	async function execute(target: DiscoverQuery = query) {
		setHasRun(true);
		setOutcome(null);
		setErr(null);
		setSteps(initialSteps(DISCOVER_STEPS));
		setPending(true);
		try {
			const conditionIds = target.conditions.flatMap(
				(k) => CONDITION_CHIPS.find((c) => c.value === k)?.ids ?? [],
			);
			const inputs: DiscoverInputs = {
				q: target.q.trim() || undefined,
				categoryId: target.categoryId || undefined,
				minPriceCents: target.priceMin ? Math.round(Number.parseFloat(target.priceMin) * 100) : undefined,
				maxPriceCents: target.priceMax ? Math.round(Number.parseFloat(target.priceMax) * 100) : undefined,
				conditionIds: conditionIds.length > 0 ? conditionIds : undefined,
				shipsFrom: target.shipsFrom || undefined,
				sort: target.sort || undefined,
				limit: target.limit,
			};
			const runner = mockMode ? runDiscoverMock : runDiscover;
			const result = await runner(inputs, (key, p) =>
				setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...p } : s))),
			);
			if (result) {
				setOutcome(result);
				recent.add({
					id: JSON.stringify(target),
					mode: "discover",
					label: describe(target),
					query: target,
					timestamp: Date.now(),
					summary: `${result.deals.length} deals`,
				});
			}
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

	function rerunRecent(run: RecentRun<DiscoverQuery>) {
		setQuery(run.query);
		void execute(run.query);
	}

	// Each preset MUST set `q` — backend rejects category-only queries
	// today (see BrowseSearchQuery TODO). A category alone would fill the
	// form but leave Run disabled, which reads as the demo being broken.
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
					</div>
				</div>
			)}

			{(outcome || hasRun || err) && (
				<ComposeOutput>
					{err && <p className="text-[13px] text-[#c0392b] mb-3">{err}</p>}
					{pending && !outcome && (
						<div className="flex items-center gap-2.5 mb-4 text-[12.5px] text-[var(--text-3)]">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin" aria-hidden="true">
								<path d="M21 12a9 9 0 1 1-6.2-8.55" />
							</svg>
							<span>Running…</span>
						</div>
					)}
					{outcome ? (
						<DealsTable
							deals={outcome.deals}
							items={outcome.search.itemSummaries ?? []}
							onEvaluate={onEvaluate}
						/>
					) : hasRun ? (
						<Trace steps={steps} />
					) : null}
					{outcome && (
						<>
							<h2 className="text-[12px] uppercase tracking-[0.06em] text-[var(--text-3)] mt-7 mb-2 font-mono">
								Trace
							</h2>
							<Trace steps={steps} />
						</>
					)}
				</ComposeOutput>
			)}
			</ComposeCard>

			<div className="max-w-[760px] mx-auto mt-4">
				<QuickStarts items={QUICKSTARTS} />
				<RecentRuns runs={recent.runs} onPick={rerunRecent} onClear={recent.clear} />
			</div>
		</>
	);
}

function DealsTable({
	deals,
	items,
	onEvaluate,
}: {
	deals: RankedDeal[];
	items: ItemSummary[];
	onEvaluate: (itemId: string) => void;
}) {
	if (deals.length === 0) {
		return (
			<p className="text-[13px] text-[var(--text-3)]">
				No deals matched. Try a wider category, looser price cap, or a different keyword.
			</p>
		);
	}
	const byId = new Map(items.map((i) => [i.itemId, i]));
	return (
		<motion.section initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
			<h2 className="text-[13px] font-medium text-[var(--text)] mb-3">
				Top {deals.length} deal{deals.length === 1 ? "" : "s"} · sorted by $/day
			</h2>
			<div className="flex flex-col gap-1.5">
				{deals.map((d) => (
					<DealRow key={d.itemId} deal={d} item={byId.get(d.itemId)} onEvaluate={onEvaluate} />
				))}
			</div>
		</motion.section>
	);
}

function DealRow({
	deal,
	item,
	onEvaluate,
}: {
	deal: RankedDeal;
	item: ItemSummary | undefined;
	onEvaluate: (itemId: string) => void;
}) {
	const exit = deal.verdict.recommendedExit;
	const buyCents = item?.price ? Math.round(Number.parseFloat(item.price.value) * 100) : undefined;
	return (
		<button
			type="button"
			onClick={() => onEvaluate(deal.itemId)}
			className="w-full text-left grid grid-cols-[44px_1fr_auto] gap-3 items-center px-3 py-2.5 border border-[var(--border-faint)] rounded-[6px] hover:border-[var(--border)] hover:bg-[var(--surface-2)] cursor-pointer transition-colors duration-100"
		>
			<div className="w-11 h-11 rounded-[4px] border border-[var(--border-faint)] bg-[var(--surface)] overflow-hidden flex items-center justify-center text-[var(--text-4)]">
				{item?.image?.imageUrl ? (
					<img src={item.image.imageUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
				) : (
					<span aria-hidden="true">·</span>
				)}
			</div>
			<div className="min-w-0">
				<div className="text-[13px] text-[var(--text)] truncate">
					{item?.title ?? deal.itemId}
				</div>
				<div className="text-[11.5px] text-[var(--text-3)] mt-0.5">
					{exit ? (
						<>
							list ${Math.round(exit.listPriceCents / 100)} · ~{Math.round(exit.expectedDays)}d ·{" "}
							{exit.netCents >= 0 ? "+" : "−"}${Math.abs(Math.round(exit.netCents / 100))} net
						</>
					) : (
						<>{item?.condition ?? "no exit plan"}</>
					)}
				</div>
			</div>
			<div className="text-right">
				{buyCents != null && (
					<div className="font-mono text-[13px] text-[var(--text)]">
						${Math.round(buyCents / 100)}
					</div>
				)}
				{exit && (
					<div className="font-mono text-[11.5px] text-[var(--brand)] mt-0.5">
						${Math.round(exit.dollarsPerDay / 100)}/day
					</div>
				)}
			</div>
		</button>
	);
}

function fmtUsd(cents: number | undefined): string {
	if (cents == null) return "—";
	return `$${(cents / 100).toFixed(2)}`;
}

function fmtPct(p: number | undefined): string {
	if (p == null) return "—";
	return `${Math.round(p * 100)}%`;
}
