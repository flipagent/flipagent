/**
 * Field — two-column row primitive (label / control). Hand-rolling this
 * once, in one place, beats every panel reinventing a label-control layout.
 *
 * The label is always rendered as plain text (no native `<label htmlFor>`)
 * because our controls below are mostly Radix-backed (Select, ToggleGroup)
 * which render multiple internal elements; a wrapping label would be
 * semantically wrong. Custom controls expose their own aria-labelledby
 * via the `id` we generate here.
 */

import { type ReactNode, useId } from "react";

export function Field({
	label,
	hint,
	children,
	id,
}: {
	label: ReactNode;
	hint?: ReactNode;
	children: (controlId: string) => ReactNode;
	/** Override the auto-generated id (rarely needed). */
	id?: string;
}) {
	const auto = useId();
	const controlId = id ?? auto;
	const labelId = `${controlId}-label`;
	return (
		<div className="ui-field">
			<div className="ui-field-label">
				<span id={labelId}>{label}</span>
				{hint && <span className="ui-field-hint">{hint}</span>}
			</div>
			<div className="ui-field-control">{children(labelId)}</div>
		</div>
	);
}
