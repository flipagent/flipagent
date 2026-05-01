/**
 * Search — flipagent's unified search panel. Hits `/v1/search` which
 * dispatches to Browse (active) or Marketplace Insights (sold) by
 * `mode`. Single synchronous call (no compute job, no SSE) so the
 * runner is much smaller than Evaluate / Discover.
 *
 * Active vs Sold lives on the filter row as a Mode pill — flipping it
 * keeps the rest of the form intact so users can pivot between "what's
 * listed now" and "what actually sold" in one click. Sort is hidden on
 * sold (Marketplace Insights has no sort axis); price / condition /
 * ships-from / category / limit work in both modes.
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
import { playgroundApi } from "./api";
import { friendlyErrorMessage, toBannerError } from "./pipelines";
import { QuickStarts, type QuickStart } from "./QuickStarts";
import { useRecentRuns, type RecentRun } from "./recent";
import { RecentRuns } from "./RecentRuns";
import { SearchResult, type SearchOutcome } from "./SearchResult";
import type { BrowseSearchResponse, Step } from "./types";

/* ------------------------------ options ------------------------------ */

type SearchMode = "active" | "sold";
type SortValue = "" | "endingSoonest" | "newlyListed" | "pricePlusShippingLowest";
type ConditionKey = "new" | "newother" | "refurb" | "used" | "parts";
type ShipsFrom = "" | "US" | "EU" | "GB" | "DE" | "JP" | "KR" | "CN" | "HK";

const MODE_OPTIONS: ReadonlyArray<SelectOption<SearchMode>> = [
	{ value: "active", label: "Listed now" },
	{ value: "sold", label: "Recently sold" },
];

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

// Same canonical id mapping Discover uses — keep them aligned so a
// user moving between panels gets identical filter semantics.
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
	{ value: "", label: "Best match" },
	{ value: "endingSoonest", label: "Ending soonest" },
	{ value: "newlyListed", label: "Newly listed" },
	{ value: "pricePlusShippingLowest", label: "Lowest price" },
];

/* --------------------------- icons --------------------------- */

const IconMode = (
	<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
		<path d="M2 8h12M2 4h12M2 12h12" />
	</svg>
);
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

interface SearchQuery {
	q: string;
	mode: SearchMode;
	categoryId: string;
	priceMin: string;
	priceMax: string;
	conditions: ConditionKey[];
	shipsFrom: ShipsFrom;
	sort: SortValue;
	limit: number;
}

const EMPTY_QUERY: SearchQuery = {
	q: "",
	mode: "active",
	categoryId: "",
	priceMin: "",
	priceMax: "",
	conditions: [],
	shipsFrom: "",
	sort: "",
	limit: 25,
};

function describe(q: SearchQuery): string {
	const parts: string[] = [];
	parts.push(q.mode === "sold" ? "Sold" : "Active");
	if (q.q) parts.push(`"${q.q}"`);
	const c = CATEGORY_OPTIONS.find((o) => o.value === q.categoryId);
	if (c && q.categoryId) parts.push(c.label);
	if (q.priceMin || q.priceMax) parts.push(`$${q.priceMin || "0"}–${q.priceMax || "∞"}`);
	if (q.conditions.length > 0)
		parts.push(q.conditions.map((k) => CONDITION_CHIPS.find((c) => c.value === k)?.label ?? k).join("/"));
	if (q.shipsFrom) parts.push(SHIPS_FROM_OPTIONS.find((s) => s.value === q.shipsFrom)?.label ?? q.shipsFrom);
	if (q.mode === "active" && q.sort) parts.push(SORT_OPTIONS.find((s) => s.value === q.sort)?.label ?? q.sort);
	return parts.join(" · ");
}

/**
 * Compile structured form fields into eBay's filter expression. Same
 * shape Discover uses; kept inline to avoid coupling the two panels'
 * input types. eBay docs:
 * https://developer.ebay.com/api-docs/buy/static/ref-buy-browse-filters.html
 */
function buildFilterString(q: SearchQuery): string | undefined {
	const parts: string[] = [];
	if (q.conditions.length > 0) {
		const ids = q.conditions.flatMap((k) => CONDITION_CHIPS.find((c) => c.value === k)?.ids ?? []);
		if (ids.length > 0) parts.push(`conditionIds:{${ids.join("|")}}`);
	}
	if (q.priceMin || q.priceMax) {
		const lo = q.priceMin ? Number(q.priceMin).toFixed(2) : "";
		const hi = q.priceMax ? Number(q.priceMax).toFixed(2) : "";
		parts.push(`price:[${lo}..${hi}],priceCurrency:USD`);
	}
	if (q.shipsFrom === "EU") parts.push("itemLocationRegion:{EUROPEAN_UNION}");
	else if (q.shipsFrom) parts.push(`itemLocationCountry:${q.shipsFrom}`);
	return parts.length > 0 ? parts.join(",") : undefined;
}

/* ----------------------------- component ----------------------------- */

export function PlaygroundSearch<TabId extends string = "search" | "discover" | "evaluate">({
	tabsProps,
}: {
	tabsProps: {
		tabs: ReadonlyArray<ComposeTab<TabId>>;
		active: TabId;
		onChange: (next: TabId) => void;
	};
}) {
	const [query, setQuery] = useState<SearchQuery>(EMPTY_QUERY);
	const [moreOpen, setMoreOpen] = useState(false);
	const [steps, setSteps] = useState<Step[]>([]);
	const [pending, setPending] = useState(false);
	const [outcome, setOutcome] = useState<SearchOutcome>({
		mode: "active",
		limit: EMPTY_QUERY.limit,
		offset: 0,
	});
	const [hasRun, setHasRun] = useState(false);
	const [err, setErr] = useState<{ message: string; upgradeUrl?: string } | null>(null);
	const recent = useRecentRuns<SearchQuery>("search");
	const abortRef = useRef<AbortController | null>(null);

	useEffect(() => () => abortRef.current?.abort(), []);

	const moreActive = useMemo(() => {
		let n = 0;
		if (query.priceMin || query.priceMax) n++;
		if (query.conditions.length > 0) n++;
		if (query.limit !== 25) n++;
		return n;
	}, [query.priceMin, query.priceMax, query.conditions, query.limit]);

	const canRun = query.q.trim().length > 0 && !pending;

	function patch<K extends keyof SearchQuery>(k: K, v: SearchQuery[K]) {
		setQuery((prev) => ({ ...prev, [k]: v }));
	}

	function applyPreset(preset: Partial<SearchQuery>) {
		setQuery({ ...EMPTY_QUERY, ...preset });
	}

	function cancel() {
		abortRef.current?.abort();
		setPending(false);
	}

	async function execute(target: SearchQuery = query, offset = 0) {
		setHasRun(true);
		setErr(null);
		setPending(true);
		// Seed outcome with the request shape so SearchResult can render
		// `limit` skeleton rows + the right "Showing N–M of …" range
		// while we wait. `body` lands on success.
		setOutcome((prev) => ({
			mode: target.mode,
			limit: target.limit,
			offset,
			// On pagination (offset > 0), keep the previous body around so
			// the row table doesn't collapse to an empty state mid-fetch.
			// The skeleton still wins because we render based on `pending`.
			body: offset > 0 ? prev.body : undefined,
		}));
		const stepKey = "search";
		const filter = buildFilterString(target);
		const params = {
			q: target.q.trim(),
			mode: target.mode,
			limit: target.limit,
			...(offset > 0 ? { offset } : {}),
			...(filter ? { filter } : {}),
			...(target.mode === "active" && target.sort ? { sort: target.sort } : {}),
			...(target.categoryId ? { category_ids: target.categoryId } : {}),
		};
		const plan = playgroundApi.search(params);
		setSteps([
			{
				key: stepKey,
				label: target.mode === "sold" ? "Search recently-sold listings" : "Search active listings",
				status: "running",
				call: plan.call,
				requestBody: plan.requestBody,
			},
		]);

		const recentBase = {
			id: JSON.stringify(target),
			mode: "search" as const,
			label: describe(target),
			query: target,
		};
		recent.add({ ...recentBase, timestamp: Date.now(), status: "in_progress" });

		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;

		try {
			const res = await plan.exec();
			if (!res.ok) {
				const body = (res.body ?? null) as Record<string, unknown> | null;
				const code = typeof body?.error === "string" ? (body.error as string) : undefined;
				const rawMessage =
					typeof body?.message === "string"
						? (body.message as string)
						: res.status === 0
							? "network error"
							: `HTTP ${res.status}`;
				const friendly =
					res.status === 0
						? `Couldn't reach the API — ${rawMessage}`
						: friendlyErrorMessage(rawMessage, code, body);
				const upgradeUrl =
					typeof body?.upgrade === "string" ? (body.upgrade as string) : undefined;
				setErr({ message: friendly, ...(upgradeUrl ? { upgradeUrl } : {}) });
				setSteps((prev) =>
					prev.map((s) =>
						s.key === stepKey
							? {
									...s,
									status: "error",
									httpStatus: res.status,
									result: res.body,
									error: friendly,
									durationMs: res.durationMs,
								}
							: s,
					),
				);
				recent.add({ ...recentBase, timestamp: Date.now(), status: "failure" });
				return;
			}
			const body = res.body as BrowseSearchResponse;
			setOutcome({ mode: target.mode, limit: target.limit, offset, body });
			setSteps((prev) =>
				prev.map((s) =>
					s.key === stepKey
						? {
								...s,
								status: "ok",
								httpStatus: res.status,
								result: res.body,
								durationMs: res.durationMs,
							}
						: s,
				),
			);
			recent.add({ ...recentBase, timestamp: Date.now(), status: "success" });
		} catch (caught) {
			// fetch() throws on abort. Treat as cancellation rather than error.
			if (controller.signal.aborted) {
				recent.add({ ...recentBase, timestamp: Date.now(), status: "cancelled" });
				setSteps((prev) =>
					prev.map((s) => (s.status === "running" ? { ...s, status: "skipped" } : s)),
				);
				return;
			}
			const banner = toBannerError(caught);
			setErr(banner);
			setSteps((prev) =>
				prev.map((s) => (s.status === "running" ? { ...s, status: "error", error: banner.message } : s)),
			);
			recent.add({ ...recentBase, timestamp: Date.now(), status: "failure" });
		} finally {
			setPending(false);
		}
	}

	function reopen(rec: RecentRun<SearchQuery>) {
		setQuery(rec.query);
		void execute(rec.query);
	}

	// Reseller-grade specificity: a real model reference (not "watch"), a
	// real card + grade (not "charizard"), a real model + colorway + size
	// (not "air jordan"). Picking the SKU at this level is what separates
	// a flip search from a window-shop. Discover's broad-keyword presets
	// stay broad on purpose — different intent.
	const QUICKSTARTS: ReadonlyArray<QuickStart> = [
		{
			label: "Seiko SKX007 black dial",
			apply: () => applyPreset({ q: "Seiko SKX007 black dial", categoryId: "31387" }),
		},
		{
			label: "Sold Charizard Base Shadowless PSA 9",
			apply: () =>
				applyPreset({ q: "Charizard Base Set Shadowless PSA 9", categoryId: "183454", mode: "sold" }),
		},
		{
			label: "Jordan 1 Mocha size 10",
			apply: () => applyPreset({ q: "Jordan 1 Retro High OG Mocha size 10", categoryId: "15709" }),
		},
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
					placeholder='Search any SKU — e.g. "Jordan 1 Retro High OG Mocha size 10"'
				/>

				<ComposeFilters>
					<FilterPill
						value={query.mode}
						defaultValue="active"
						options={MODE_OPTIONS}
						onChange={(v) => patch("mode", v)}
						icon={IconMode}
						label="Mode"
					/>
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
					{query.mode === "active" && (
						<FilterPill
							value={query.sort}
							options={SORT_OPTIONS}
							onChange={(v) => patch("sort", v)}
							icon={IconSort}
							label="Sort"
						/>
					)}
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
										max={200}
										value={query.limit}
										onChange={(e) =>
											patch("limit", Math.max(1, Math.min(200, Number(e.target.value) || 1)))
										}
										className="w-[100px] text-[13px] px-3 py-1.5 border border-[var(--border)] rounded-[6px] bg-[var(--surface)] text-[var(--text)] outline-none focus:border-[var(--text-3)]"
									/>
								)}
							</Field>
						</div>
					</div>
				)}

				{(hasRun || err) && (
					<ComposeOutput>
						{err && (
							<p className="text-[13px] text-[#c0392b] mb-3">
								{err.message}
								{err.upgradeUrl && (
									<>
										{" "}
										<a
											href={err.upgradeUrl}
											className="underline underline-offset-2 font-medium hover:opacity-80"
										>
											Upgrade →
										</a>
									</>
								)}
							</p>
						)}
						{hasRun && !err && (
						<SearchResult
							outcome={outcome}
							steps={steps}
							pending={pending}
							onPage={(nextOffset) => void execute(query, nextOffset)}
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
