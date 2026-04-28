/**
 * Toolbar-style Select pill for the filter row inside ComposeFilters.
 * Same Radix-backed Select behaviour as the rest of the dashboard, but
 * skinned as a slim icon + label pill (vs the full bordered field used
 * in stand-alone forms).
 *
 * Use when the filter has a discrete option set (Category, Sort, Ships
 * from). For range/multi-select filters that don't fit in a Select,
 * compose a Radix Popover yourself.
 */

import * as RxSelect from "@radix-ui/react-select";
import type { ReactNode } from "react";

export interface SelectOption<V extends string> {
	value: V;
	label: string;
}

const EMPTY_SENTINEL = "__empty__";
const toRadix = (v: string): string => (v === "" ? EMPTY_SENTINEL : v);
const fromRadix = (v: string): string => (v === EMPTY_SENTINEL ? "" : v);

export function FilterPill<V extends string>({
	value,
	options,
	onChange,
	icon,
	defaultLabel,
}: {
	value: V;
	options: ReadonlyArray<SelectOption<V>>;
	onChange: (v: V) => void;
	icon: ReactNode;
	/** Shown when value is empty (default state). */
	defaultLabel: string;
}) {
	const selected = options.find((o) => o.value === value);
	const isDefault = !selected || value === ("" as V);
	return (
		<RxSelect.Root value={toRadix(value)} onValueChange={(v) => onChange(fromRadix(v) as V)}>
			<RxSelect.Trigger
				className={`flex items-center gap-1.5 h-7 px-2.5 rounded-[6px] text-[12px] border transition-colors duration-100 cursor-pointer outline-none ${
					isDefault
						? "border-[var(--border-faint)] text-[var(--text-3)] hover:text-[var(--text)] hover:border-[var(--border)]"
						: "border-[var(--brand)] text-[var(--brand)] bg-[var(--brand-soft)]"
				} data-[state=open]:border-[var(--text-3)] data-[state=open]:text-[var(--text)]`}
			>
				<span className="flex items-center" aria-hidden="true">
					{icon}
				</span>
				<RxSelect.Value>{isDefault ? defaultLabel : selected?.label}</RxSelect.Value>
				<RxSelect.Icon aria-hidden="true">
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
