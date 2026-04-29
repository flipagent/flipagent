/**
 * Form-context Select for use inside `<Field>` rows (More panel,
 * settings forms). Same Radix Select machinery as `FilterPill` but
 * skinned as a bordered input box matching the number / text inputs
 * around it — chevron on the right, no icon, no inline label (the
 * surrounding Field carries the label).
 *
 * Use this when the control sits next to other form fields.
 * Use `FilterPill` when it sits in the toolbar pill row.
 */

import * as RxSelect from "@radix-ui/react-select";
import type { ReactNode } from "react";

export interface FormSelectOption<V extends string> {
	value: V;
	label: ReactNode;
}

const EMPTY_SENTINEL = "__empty__";
const toRadix = (v: string): string => (v === "" ? EMPTY_SENTINEL : v);
const fromRadix = (v: string): string => (v === EMPTY_SENTINEL ? "" : v);

export function FormSelect<V extends string>({
	value,
	options,
	onChange,
	placeholder,
	width = 200,
	"aria-labelledby": ariaLabelledBy,
}: {
	value: V;
	options: ReadonlyArray<FormSelectOption<V>>;
	onChange: (v: V) => void;
	/** Shown when no option matches the current value. */
	placeholder?: string;
	/** px width of the trigger box. Match siblings in the Field row for tidy alignment. */
	width?: number;
	"aria-labelledby"?: string;
}) {
	const selected = options.find((o) => o.value === value);
	return (
		<RxSelect.Root value={toRadix(value)} onValueChange={(v) => onChange(fromRadix(v) as V)}>
			<RxSelect.Trigger
				aria-labelledby={ariaLabelledBy}
				style={{ width }}
				className="flex items-center justify-between gap-2 text-[13px] px-3 py-1.5 border border-[var(--border)] rounded-[6px] bg-[var(--surface)] text-[var(--text)] cursor-pointer outline-none transition-colors duration-100 hover:border-[var(--text-3)] hover:bg-[var(--surface-2)] focus:border-[var(--text-3)] data-[state=open]:border-[var(--text-3)] data-[state=open]:bg-[var(--surface-2)]"
			>
				<RxSelect.Value placeholder={placeholder ?? ""}>
					{selected ? selected.label : <span className="text-[var(--text-3)]">{placeholder}</span>}
				</RxSelect.Value>
				<RxSelect.Icon aria-hidden="true" className="text-[var(--text-3)]">
					<svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
						<path d="m3 4 2 2 2-2" />
					</svg>
				</RxSelect.Icon>
			</RxSelect.Trigger>
			<RxSelect.Portal>
				<RxSelect.Content
					position="popper"
					sideOffset={4}
					className="z-50 min-w-[var(--radix-select-trigger-width)] max-h-[var(--radix-select-content-available-height)] overflow-hidden bg-[var(--surface)] border border-[var(--border)] rounded-[6px] shadow-[0_8px_28px_rgba(0,0,0,0.10)]"
				>
					<RxSelect.Viewport className="py-1">
						{options.map((o) => (
							<RxSelect.Item
								key={o.value}
								value={toRadix(o.value)}
								className="flex items-center justify-between gap-3 px-3 py-2 text-[13px] text-[var(--text)] cursor-pointer outline-none select-none data-[highlighted]:bg-[var(--surface-2)] data-[state=checked]:text-[var(--brand)] data-[state=checked]:font-medium"
							>
								<RxSelect.ItemText>{o.label}</RxSelect.ItemText>
								<RxSelect.ItemIndicator className="text-[var(--brand)]" aria-hidden="true">
									<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
										<path d="m2.5 6 2.5 2.5L9.5 3.5" />
									</svg>
								</RxSelect.ItemIndicator>
							</RxSelect.Item>
						))}
					</RxSelect.Viewport>
				</RxSelect.Content>
			</RxSelect.Portal>
		</RxSelect.Root>
	);
}
