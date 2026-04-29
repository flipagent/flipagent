/**
 * Decision-floor filters shared between Evaluate and Discover. Three knobs
 * that shape what counts as a "deal" worth surfacing:
 *
 *   - Min profit  → minNetCents floor (cents below which a flip isn't a flip)
 *   - Sell within → maxDaysToSell window (capital-tied-up cap)
 *   - Shipping    → outbound shipping cost (default $10, US 1-2lb box)
 *
 * Same component on both surfaces so users learn the controls once and
 * the underlying scoring engine receives identical opts. Lives next to
 * the other shared playground bits — no compose/ui dependency since the
 * Field + FormSelect components own their styling.
 */

import { FormSelect } from "../compose/FormSelect";
import { Field } from "../ui/Field";
import type { SelectOption } from "../compose/FilterPill";

export const MIN_PROFIT_OPTIONS: ReadonlyArray<SelectOption<string>> = [
	{ value: "5", label: "$5" },
	{ value: "10", label: "$10" },
	{ value: "25", label: "$25" },
	{ value: "50", label: "$50" },
	{ value: "100", label: "$100" },
];

export const SELL_WITHIN_OPTIONS: ReadonlyArray<SelectOption<string>> = [
	{ value: "1", label: "1 day" },
	{ value: "3", label: "3 days" },
	{ value: "7", label: "7 days" },
	{ value: "14", label: "14 days" },
	{ value: "30", label: "1 month" },
	{ value: "90", label: "3 months" },
	{ value: "180", label: "6 months" },
];

export const SHIPPING_OPTIONS: ReadonlyArray<SelectOption<string>> = [
	{ value: "5", label: "$5" },
	{ value: "10", label: "$10" },
	{ value: "15", label: "$15" },
	{ value: "25", label: "$25" },
	{ value: "50", label: "$50" },
];

export const DEAL_FILTER_DEFAULTS = {
	minProfit: "10",
	sellWithin: "180",
	shipping: "10",
} as const;

export interface DealFiltersValue {
	minProfit: string;
	sellWithin: string;
	shipping: string;
}

/**
 * Count of knobs not at default. Both surfaces use this to badge their
 * "More" toggle.
 */
export function countActiveDealFilters(v: DealFiltersValue): number {
	return (
		(v.minProfit !== DEAL_FILTER_DEFAULTS.minProfit ? 1 : 0) +
		(v.sellWithin !== DEAL_FILTER_DEFAULTS.sellWithin ? 1 : 0) +
		(v.shipping !== DEAL_FILTER_DEFAULTS.shipping ? 1 : 0)
	);
}

export function DealFilters({
	value,
	onChange,
}: {
	value: DealFiltersValue;
	onChange: (next: DealFiltersValue) => void;
}) {
	return (
		<div className="flex flex-col gap-3">
			<Field label="Min profit">
				{(labelId) => (
					<FormSelect
						value={value.minProfit}
						options={MIN_PROFIT_OPTIONS}
						onChange={(v) => onChange({ ...value, minProfit: v })}
						aria-labelledby={labelId}
					/>
				)}
			</Field>
			<Field label="Sell within">
				{(labelId) => (
					<FormSelect
						value={value.sellWithin}
						options={SELL_WITHIN_OPTIONS}
						onChange={(v) => onChange({ ...value, sellWithin: v })}
						aria-labelledby={labelId}
					/>
				)}
			</Field>
			<Field label="Shipping">
				{(labelId) => (
					<FormSelect
						value={value.shipping}
						options={SHIPPING_OPTIONS}
						onChange={(v) => onChange({ ...value, shipping: v })}
						aria-labelledby={labelId}
					/>
				)}
			</Field>
		</div>
	);
}
