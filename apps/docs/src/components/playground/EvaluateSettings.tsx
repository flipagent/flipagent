/**
 * Per-call Evaluate settings — scoring engine inputs, not search filters.
 * Two knobs that shape the recommendation:
 *
 *   - Min profit  → minNetCents floor (cents below which a flip isn't a flip)
 *   - Shipping    → outbound shipping cost (default $10, US 1-2lb box)
 *
 * Sell within (the maxDaysToSell window) lives in the main filter row —
 * it's the same "time" axis as Look back / Sample size and reads as a
 * primary search input, not a hidden detail knob.
 *
 * Evaluate-only — Sourcing has its own SearchFilters surface for actual
 * eBay-side query params. Field + FormSelect own their own styling.
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
	{ value: "60", label: "2 months" },
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

export const EVALUATE_SETTINGS_DEFAULTS = {
	minProfit: "10",
	shipping: "10",
} as const;

export interface EvaluateSettingsValue {
	minProfit: string;
	shipping: string;
}

/**
 * Count of knobs not at default. Used to badge the "More" toggle.
 */
export function countActiveEvaluateSettings(v: EvaluateSettingsValue): number {
	return (
		(v.minProfit !== EVALUATE_SETTINGS_DEFAULTS.minProfit ? 1 : 0) +
		(v.shipping !== EVALUATE_SETTINGS_DEFAULTS.shipping ? 1 : 0)
	);
}

export function EvaluateSettings({
	value,
	onChange,
}: {
	value: EvaluateSettingsValue;
	onChange: (next: EvaluateSettingsValue) => void;
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
