/**
 * Per-call Evaluate settings — scoring engine inputs, not search filters.
 * Two knobs that shape the recommendation:
 *
 *   - Min profit  → minNetCents floor (cents below which a flip isn't a flip)
 *   - Shipping    → outbound shipping cost (default $10, US 1-2lb box)
 *
 * Sell within (the client-side over-budget warning threshold) lives in
 * the main filter row — it's the same "time" axis as Look back / Sample
 * size and reads as a primary search input, not a hidden detail knob.
 * Does not affect the server-side recommendation: time is emergent from
 * queue position + salesPerDay, not capped.
 *
 * Evaluate-only — Sourcing has its own SearchFilters surface for actual
 * eBay-side query params. Field + FormSelect own their own styling.
 */

import { FormSelect } from "../compose/FormSelect";
import { Field } from "../ui/Field";
import type { SelectOption } from "../compose/FilterPill";

export const MIN_PROFIT_OPTIONS: ReadonlyArray<SelectOption<string>> = [
	{ value: "0", label: "Any positive" },
	{ value: "5", label: "$5" },
	{ value: "10", label: "$10" },
	{ value: "30", label: "$30" },
	{ value: "50", label: "$50" },
	{ value: "100", label: "$100" },
];

export const SHIPPING_OPTIONS: ReadonlyArray<SelectOption<string>> = [
	{ value: "5", label: "$5" },
	{ value: "10", label: "$10" },
	{ value: "15", label: "$15" },
	{ value: "25", label: "$25" },
	{ value: "50", label: "$50" },
];

// minProfit "0" matches the backend's DEFAULT_MIN_NET_CENTS — the rating
// gate is "is this a profitable trade?" (positive risk-adjusted EV);
// reseller-specific dollar floors are an opt-in tightening.
export const EVALUATE_SETTINGS_DEFAULTS = {
	minProfit: "0",
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
