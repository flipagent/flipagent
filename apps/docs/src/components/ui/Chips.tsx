/**
 * Chips — multi-select chip group on @radix-ui/react-toggle-group.
 * Toggleable buttons backed by `ToggleGroup type="multiple"`.
 *
 * Radix gives us roving-tabindex keyboard nav, role=group + role=button
 * with aria-pressed, and clean controlled state.
 */

import * as RxToggleGroup from "@radix-ui/react-toggle-group";

export interface ChipOption<V extends string> {
	value: V;
	label: string;
}

export function Chips<V extends string>({
	value,
	options,
	onChange,
	"aria-labelledby": ariaLabelledBy,
}: {
	value: V[];
	options: ReadonlyArray<ChipOption<V>>;
	onChange: (next: V[]) => void;
	"aria-labelledby"?: string;
}) {
	return (
		<RxToggleGroup.Root
			type="multiple"
			value={value}
			onValueChange={(v) => onChange(v as V[])}
			className="ui-chips"
			aria-labelledby={ariaLabelledBy}
		>
			{options.map((o) => (
				<RxToggleGroup.Item key={o.value} value={o.value} className="ui-chip">
					{o.label}
				</RxToggleGroup.Item>
			))}
		</RxToggleGroup.Root>
	);
}
