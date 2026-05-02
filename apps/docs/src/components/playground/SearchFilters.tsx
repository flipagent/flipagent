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

/* ----------------------------- helpers ----------------------------- */

/**
 * Compile structured form fields into eBay's filter expression.
 * Conditions / price / buyingOption are pulled out by the api adapter
 * and sent as their own flipagent-native query params; the rest
 * (location, free-shipping, returns, top-rated) ride through the raw
 * `filter` passthrough. eBay docs:
 * https://developer.ebay.com/api-docs/buy/static/ref-buy-browse-filters.html
 */
export function buildFilterString(q: SearchQuery): string | undefined {
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
	if (q.buyingOption === "auction") parts.push("buyingOptions:{AUCTION}");
	else if (q.buyingOption === "fixed_price") parts.push("buyingOptions:{FIXED_PRICE}");
	else if (q.buyingOption === "best_offer") parts.push("buyingOptions:{BEST_OFFER}");
	if (q.shipsFrom === "eu") parts.push("itemLocationRegion:{EUROPEAN_UNION}");
	else if (q.shipsFrom) parts.push(`itemLocationCountry:${q.shipsFrom.toUpperCase()}`);
	if (q.refinements.includes("free_shipping")) parts.push("maxDeliveryCost:0");
	if (q.refinements.includes("returns_accepted")) parts.push("returnsAccepted:true");
	if (q.refinements.includes("top_rated")) parts.push("topRatedListing:true");
	return parts.length > 0 ? parts.join(",") : undefined;
}

/**
 * Build the param object expected by `playgroundApi.search()`. Single
 * source of truth for "translate SearchQuery → API call shape" so both
 * panels produce identical wire-format requests.
 */
export function searchQueryToParams(target: SearchQuery, offset = 0) {
	const filter = buildFilterString(target);
	const trimmedQ = target.q.trim();
	return {
		...(trimmedQ ? { q: trimmedQ } : {}),
		mode: target.mode,
		limit: target.limit,
		...(offset > 0 ? { offset } : {}),
		...(filter ? { filter } : {}),
		...(target.mode === "active" && target.sort ? { sort: target.sort } : {}),
		...(target.category ? { category_ids: target.category.id } : {}),
		...(target.gtin ? { gtin: target.gtin } : {}),
	};
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
