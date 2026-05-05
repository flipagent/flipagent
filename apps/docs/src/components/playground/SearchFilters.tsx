/**
 * Shared filter row + More expansion for the unified search surface.
 *
 * Both Search (start with keyword) and Sourcing (start with category) use
 * this — the underlying search is identical (`/v1/items/search`), the
 * difference is just where the user enters the funnel. Sourcing passes
 * `showCategoryPicker={false}` because the category is set by the tree
 * pane on the left.
 *
 * Owns: Mode pill, Category picker (optional), Sort pill, More button +
 * More section (Price / Condition / Format / Ships from / UPC /
 * Refinements / Limit). Does NOT own the keyword input — that's the
 * caller's responsibility (placement differs between panels).
 */

import { type ReactNode, useMemo, useState } from "react";
import { FilterPill, type SelectOption } from "../compose/FilterPill";
import { type ChipOption, Chips, ChipsSingle } from "../ui/Chips";
import { Field } from "../ui/Field";
import { CategoryFilterPicker } from "./CategoryFilterPicker";

/* ------------------------------ types ------------------------------ */

export type SearchMode = "active" | "sold";
export type SortValue = "" | "endingSoonest" | "newlyListed" | "pricePlusShippingLowest";
export type ConditionKey = "new" | "newother" | "refurb" | "used" | "parts";
export type ShipsFromKey = "us" | "eu" | "gb" | "de" | "jp" | "kr" | "cn" | "hk";
export type BuyingOptionKey = "auction" | "fixed_price" | "best_offer";
export type RefinementKey = "free_shipping" | "returns_accepted" | "top_rated";

export interface SearchQuery {
	q: string;
	mode: SearchMode;
	category: { id: string; name: string } | null;
	buyingOption: BuyingOptionKey | "";
	priceMin: string;
	priceMax: string;
	conditions: ConditionKey[];
	shipsFrom: ShipsFromKey | "";
	gtin: string;
	refinements: RefinementKey[];
	sort: SortValue;
	limit: number;
}

export const EMPTY_SEARCH_QUERY: SearchQuery = {
	q: "",
	mode: "active",
	category: null,
	buyingOption: "",
	priceMin: "",
	priceMax: "",
	conditions: [],
	shipsFrom: "",
	gtin: "",
	refinements: [],
	sort: "",
	limit: 25,
};

/* ----------------------------- option sets ----------------------------- */

const MODE_OPTIONS: ReadonlyArray<SelectOption<SearchMode>> = [
	{ value: "active", label: "Listed now" },
	{ value: "sold", label: "Recently sold" },
];

export const CONDITION_CHIPS: ReadonlyArray<ChipOption<ConditionKey> & { ids: string[] }> = [
	{ value: "new", label: "New", ids: ["1000"] },
	{ value: "newother", label: "New Other", ids: ["1500"] },
	{ value: "refurb", label: "Refurbished", ids: ["2010", "2020", "2030", "2040", "2500"] },
	{ value: "used", label: "Used", ids: ["3000"] },
	{ value: "parts", label: "For parts", ids: ["7000"] },
];

export const FORMAT_CHIPS: ReadonlyArray<ChipOption<BuyingOptionKey>> = [
	{ value: "auction", label: "Auction" },
	{ value: "fixed_price", label: "Buy It Now" },
	{ value: "best_offer", label: "Best Offer" },
];

export const SHIPS_FROM_CHIPS: ReadonlyArray<ChipOption<ShipsFromKey>> = [
	{ value: "us", label: "US" },
	{ value: "eu", label: "EU" },
	{ value: "gb", label: "UK" },
	{ value: "de", label: "DE" },
	{ value: "jp", label: "JP" },
	{ value: "kr", label: "KR" },
	{ value: "hk", label: "HK" },
	{ value: "cn", label: "CN" },
];

export const REFINEMENT_CHIPS: ReadonlyArray<ChipOption<RefinementKey>> = [
	{ value: "free_shipping", label: "Free shipping" },
	{ value: "returns_accepted", label: "Returns accepted" },
	{ value: "top_rated", label: "Top Rated sellers" },
];

const SORT_OPTIONS: ReadonlyArray<SelectOption<SortValue>> = [
	{ value: "", label: "Best match" },
	{ value: "endingSoonest", label: "Ending soonest" },
	{ value: "newlyListed", label: "Newly listed" },
	{ value: "pricePlusShippingLowest", label: "Lowest price" },
];

/* ------------------ wire round-trip (forward + inverse) ------------------ */

/**
 * Validated `/v1/items/search` query — the wire shape stored in
 * `compute_jobs.params`. Most fields are structured one-to-one; the
 * `filter` string only carries eBay passthroughs that don't have a
 * native API field (shipsFrom + refinements like free_shipping).
 */
export interface WireSearchParams {
	q?: string;
	status: "active" | "sold";
	limit: number;
	offset?: number;
	categoryId?: string;
	gtin?: string;
	conditionIds?: string[];
	priceMin?: number;
	priceMax?: number;
	buyingOption?: BuyingOptionKey;
	sort?: "newest" | "ending_soonest" | "price_asc";
	filter?: string;
}

const SORT_PAIR: ReadonlyArray<readonly [SortValue, WireSearchParams["sort"]]> = [
	["newlyListed", "newest"],
	["endingSoonest", "ending_soonest"],
	["pricePlusShippingLowest", "price_asc"],
];

/**
 * Forward — `SearchQuery` → wire. Single source of truth for "what we
 * send to /v1/items/search" so all panels agree. Maps:
 *
 *   - chip keys (`conditions`, `buyingOption`) → wire enums + id lists
 *   - dollar strings (`priceMin/Max`) → integer cents
 *   - sort labels → wire enums
 *   - eBay-only fields (`shipsFrom`, `refinements`) → residual `filter`
 *     string (the only field that's still string-encoded; eBay's filter
 *     spec doesn't have native equivalents at the API surface)
 */
export function searchQueryToWire(q: SearchQuery, offset = 0): WireSearchParams {
	const wire: WireSearchParams = { status: q.mode, limit: q.limit };
	const trimmedQ = q.q.trim();
	if (trimmedQ) wire.q = trimmedQ;
	if (offset > 0) wire.offset = offset;
	if (q.category) wire.categoryId = q.category.id;
	if (q.gtin) wire.gtin = q.gtin;

	const conditionIds = q.conditions.flatMap((k) => CONDITION_CHIPS.find((c) => c.value === k)?.ids ?? []);
	if (conditionIds.length > 0) wire.conditionIds = conditionIds;
	if (q.priceMin) {
		const cents = Math.round(Number(q.priceMin) * 100);
		if (Number.isFinite(cents)) wire.priceMin = cents;
	}
	if (q.priceMax) {
		const cents = Math.round(Number(q.priceMax) * 100);
		if (Number.isFinite(cents)) wire.priceMax = cents;
	}
	if (q.buyingOption) wire.buyingOption = q.buyingOption;
	if (q.mode === "active") {
		const wireSort = SORT_PAIR.find(([ui]) => ui === q.sort)?.[1];
		if (wireSort) wire.sort = wireSort;
	}

	// eBay passthrough — only fields with no native API parameter.
	const filterParts: string[] = [];
	if (q.shipsFrom === "eu") filterParts.push("itemLocationRegion:{EUROPEAN_UNION}");
	else if (q.shipsFrom) filterParts.push(`itemLocationCountry:${q.shipsFrom.toUpperCase()}`);
	if (q.refinements.includes("free_shipping")) filterParts.push("maxDeliveryCost:0");
	if (q.refinements.includes("returns_accepted")) filterParts.push("returnsAccepted:true");
	if (q.refinements.includes("top_rated")) filterParts.push("topRatedListing:true");
	if (filterParts.length > 0) wire.filter = filterParts.join(",");

	return wire;
}

/**
 * Inverse — wire → `SearchQuery`. Mirror of `searchQueryToWire` so
 * `reopen` can rehydrate the panel from the row's stored params.
 *
 * `resolveCategoryName` is an optional sync hook for restoring the
 * pretty category label (otherwise the chip falls back to showing the
 * id). `lookupCachedCategoryName` from `useCategoryTree.ts` is the
 * canonical resolver.
 *
 * Tolerant of partial / unknown shapes — anything missing falls back
 * to `EMPTY_SEARCH_QUERY` defaults rather than throwing.
 */
export function wireToSearchQuery(
	input: unknown,
	resolveCategoryName?: (id: string) => string | undefined,
): SearchQuery {
	const w = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

	const wireIds = Array.isArray(w.conditionIds) ? (w.conditionIds as string[]) : [];
	const conditions: ConditionKey[] = [];
	for (const chip of CONDITION_CHIPS) {
		if (chip.ids.some((id) => wireIds.includes(id))) conditions.push(chip.value);
	}

	const buyingOption =
		typeof w.buyingOption === "string" && ["auction", "fixed_price", "best_offer"].includes(w.buyingOption)
			? (w.buyingOption as BuyingOptionKey)
			: "";

	const sort: SortValue =
		typeof w.sort === "string" ? (SORT_PAIR.find(([, wire]) => wire === w.sort)?.[0] ?? "") : "";

	let shipsFrom: ShipsFromKey | "" = "";
	const refinements: RefinementKey[] = [];
	const filterStr = typeof w.filter === "string" ? w.filter : "";
	for (const raw of filterStr.split(",")) {
		const clause = raw.trim();
		if (!clause) continue;
		const reg = clause.match(/^itemLocationRegion:\{([^}]+)\}$/);
		if (reg && reg[1].trim().toUpperCase() === "EUROPEAN_UNION") shipsFrom = "eu";
		const cc = clause.match(/^itemLocationCountry:([A-Z]{2})$/);
		if (cc) {
			const lower = cc[1].toLowerCase() as ShipsFromKey;
			if (SHIPS_FROM_CHIPS.some((x) => x.value === lower)) shipsFrom = lower;
		}
		if (clause === "maxDeliveryCost:0") refinements.push("free_shipping");
		else if (clause === "returnsAccepted:true") refinements.push("returns_accepted");
		else if (clause === "topRatedListing:true") refinements.push("top_rated");
	}

	const categoryId = typeof w.categoryId === "string" ? w.categoryId : "";
	const category = categoryId ? { id: categoryId, name: resolveCategoryName?.(categoryId) ?? categoryId } : null;

	const limit = typeof w.limit === "number" && w.limit > 0 ? w.limit : 25;

	return {
		...EMPTY_SEARCH_QUERY,
		q: typeof w.q === "string" ? w.q : "",
		mode: w.status === "sold" ? "sold" : "active",
		category,
		buyingOption,
		priceMin: typeof w.priceMin === "number" ? centsToDollarString(w.priceMin) : "",
		priceMax: typeof w.priceMax === "number" ? centsToDollarString(w.priceMax) : "",
		conditions,
		shipsFrom,
		gtin: typeof w.gtin === "string" ? w.gtin : "",
		refinements,
		sort,
		limit,
	};
}

function centsToDollarString(cents: number): string {
	return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

/** Human-readable summary for recent-runs / breadcrumbs. */
export function describeSearchQuery(q: SearchQuery): string {
	const parts: string[] = [];
	parts.push(q.mode === "sold" ? "Sold" : "Active");
	if (q.q) parts.push(`"${q.q}"`);
	if (q.category) parts.push(q.category.name);
	if (q.buyingOption) parts.push(FORMAT_CHIPS.find((o) => o.value === q.buyingOption)?.label ?? q.buyingOption);
	if (q.priceMin || q.priceMax) parts.push(`$${q.priceMin || "0"}–${q.priceMax || "∞"}`);
	if (q.conditions.length > 0)
		parts.push(q.conditions.map((k) => CONDITION_CHIPS.find((c) => c.value === k)?.label ?? k).join("/"));
	if (q.shipsFrom) parts.push(`from ${SHIPS_FROM_CHIPS.find((s) => s.value === q.shipsFrom)?.label ?? q.shipsFrom}`);
	if (q.gtin) parts.push(`UPC ${q.gtin}`);
	for (const r of q.refinements) {
		const c = REFINEMENT_CHIPS.find((x) => x.value === r);
		if (c) parts.push(c.label);
	}
	if (q.mode === "active" && q.sort) parts.push(SORT_OPTIONS.find((s) => s.value === q.sort)?.label ?? q.sort);
	return parts.join(" · ");
}

/* ----------------------------- icons ----------------------------- */

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
const IconSort = (
	<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
		<path d="M4 3v10M2 11l2 2 2-2M12 13V3M10 5l2-2 2 2" />
	</svg>
);

/* ----------------------------- component ----------------------------- */

export interface SearchFiltersProps {
	value: SearchQuery;
	onChange: (next: SearchQuery) => void;
	/**
	 * Show the category picker pill in the filter row. Default `true`.
	 * Set to `false` in panels where the category is already chosen
	 * elsewhere (e.g. Sourcing's left tree).
	 */
	showCategoryPicker?: boolean;
	/**
	 * Optional content rendered inside the filter row before the pills,
	 * with `flex-1` so it grows. Used by Sourcing to inline its narrow-
	 * within input alongside the filter pills instead of stacking on its
	 * own line.
	 */
	prefix?: ReactNode;
}

export function SearchFilters({ value, onChange, showCategoryPicker = true, prefix }: SearchFiltersProps) {
	const [moreOpen, setMoreOpen] = useState(false);

	function patch<K extends keyof SearchQuery>(k: K, v: SearchQuery[K]) {
		onChange({ ...value, [k]: v });
	}

	const moreActive = useMemo(() => {
		let n = 0;
		if (value.priceMin || value.priceMax) n++;
		if (value.conditions.length > 0) n++;
		if (value.buyingOption) n++;
		if (value.shipsFrom) n++;
		if (value.gtin) n++;
		if (value.refinements.length > 0) n++;
		if (value.limit !== 25) n++;
		return n;
	}, [
		value.priceMin,
		value.priceMax,
		value.conditions,
		value.buyingOption,
		value.shipsFrom,
		value.gtin,
		value.refinements,
		value.limit,
	]);

	return (
		<>
			<div className="flex flex-wrap items-center gap-2 px-5 py-2.5 border-b border-[var(--border-faint)] max-sm:px-4">
				{prefix && <div className="flex-1 min-w-[180px]">{prefix}</div>}
				<FilterPill
					value={value.mode}
					defaultValue="active"
					options={MODE_OPTIONS}
					onChange={(v) => patch("mode", v)}
					icon={IconMode}
					label="Mode"
				/>
				{showCategoryPicker && (
					<CategoryFilterPicker
						value={value.category}
						onChange={(v) => patch("category", v)}
						icon={IconBox}
					/>
				)}
				{value.mode === "active" && (
					<FilterPill
						value={value.sort}
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
			</div>

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
										value={value.priceMin}
										onChange={(e) => patch("priceMin", e.target.value)}
										placeholder="min"
										className="flex-1 max-w-[140px] text-[13px] px-3 py-1.5 border border-[var(--border)] rounded-[6px] bg-[var(--surface)] text-[var(--text)] outline-none focus:border-[var(--text-3)]"
									/>
									<span className="text-[12px] text-[var(--text-3)]">to</span>
									<input
										type="number"
										min={0}
										step={1}
										value={value.priceMax}
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
									value={value.conditions}
									options={CONDITION_CHIPS}
									onChange={(v) => patch("conditions", v)}
									aria-labelledby={labelId}
								/>
							)}
						</Field>
						<Field label="Format">
							{(labelId) => (
								<ChipsSingle
									value={value.buyingOption}
									options={FORMAT_CHIPS}
									onChange={(v) => patch("buyingOption", v)}
									aria-labelledby={labelId}
								/>
							)}
						</Field>
						<Field label="Ships from">
							{(labelId) => (
								<ChipsSingle
									value={value.shipsFrom}
									options={SHIPS_FROM_CHIPS}
									onChange={(v) => patch("shipsFrom", v)}
									aria-labelledby={labelId}
								/>
							)}
						</Field>
						<Field label="UPC / EAN / ISBN">
							{() => (
								<input
									type="text"
									inputMode="numeric"
									autoComplete="off"
									value={value.gtin}
									onChange={(e) => patch("gtin", e.target.value.trim())}
									placeholder="e.g. 0194253464204"
									className="w-full max-w-[280px] text-[13px] px-3 py-1.5 border border-[var(--border)] rounded-[6px] bg-[var(--surface)] text-[var(--text)] outline-none focus:border-[var(--text-3)]"
								/>
							)}
						</Field>
						<Field label="Refinements">
							{(labelId) => (
								<Chips
									value={value.refinements}
									options={REFINEMENT_CHIPS}
									onChange={(v) => patch("refinements", v)}
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
									value={value.limit}
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
		</>
	);
}
