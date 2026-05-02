/**
 * Category-tree picker for the filter row. Opens a Radix Popover with a
 * lazy-expanding tree (root nodes load on mount, branches load on first
 * expand). Mirrors Sourcing's left-pane tree but as a transient popover
 * so the filter row stays compact.
 */

import * as RxPopover from "@radix-ui/react-popover";
import type { ReactNode } from "react";
import { type CategoryNode, useCategoryTree } from "./useCategoryTree";

interface CategoryFilterPickerProps {
	value: { id: string; name: string } | null;
	onChange: (selection: { id: string; name: string } | null) => void;
	icon: ReactNode;
}

export function CategoryFilterPicker({ value, onChange, icon }: CategoryFilterPickerProps) {
	const { roots, childrenByParent, expanded, loading, error, toggleExpanded } = useCategoryTree();
	const isDefault = !value;

	return (
		<RxPopover.Root>
			<RxPopover.Trigger
				className={`flex items-center gap-1.5 h-7 px-2.5 rounded-[6px] text-[12px] border transition-colors duration-100 cursor-pointer outline-none ${
					isDefault
						? "border-[var(--border-faint)] text-[var(--text-3)] hover:text-[var(--text)] hover:border-[var(--border)]"
						: "border-[var(--brand)] text-[var(--brand)] bg-[var(--brand-soft)]"
				} data-[state=open]:border-[var(--text-3)] data-[state=open]:text-[var(--text)]`}
			>
				<span className="flex items-center" aria-hidden="true">
					{icon}
				</span>
				<span>Category</span>
				{value && (
					<>
						<span className="opacity-60 mx-1">·</span>
						<span className="max-w-[160px] truncate">{value.name}</span>
					</>
				)}
				<svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
					<path d="m3 4 2 2 2-2" />
				</svg>
			</RxPopover.Trigger>
			<RxPopover.Portal>
				<RxPopover.Content
					align="start"
					sideOffset={4}
					className="z-50 w-[320px] max-h-[420px] overflow-y-auto bg-[var(--surface)] border border-[var(--border)] rounded-[6px] shadow-[0_8px_28px_rgba(0,0,0,0.10)] p-1"
				>
					<button
						type="button"
						onClick={() => onChange(null)}
						className={`w-full text-left px-3 py-2 text-[13px] rounded-[4px] cursor-pointer outline-none ${
							isDefault
								? "text-[var(--brand)] font-medium bg-[var(--brand-soft)]"
								: "text-[var(--text)] hover:bg-[var(--surface-2)]"
						}`}
					>
						All categories
					</button>
					{error && (
						<p className="px-3 py-2 text-[12px] text-[var(--text-3)]">
							Couldn't load categories. Refresh and try again.
						</p>
					)}
					{!error && roots === null && (
						<p className="px-3 py-2 text-[12px] text-[var(--text-3)]">Loading…</p>
					)}
					{roots && roots.length > 0 && (
						<ul className="py-1">
							{roots.map((node) => (
								<TreeItem
									key={node.id}
									node={node}
									depth={0}
									childrenByParent={childrenByParent}
									expanded={expanded}
									loading={loading}
									selected={value?.id ?? null}
									onToggle={toggleExpanded}
									onSelect={onChange}
								/>
							))}
						</ul>
					)}
				</RxPopover.Content>
			</RxPopover.Portal>
		</RxPopover.Root>
	);
}

interface TreeItemProps {
	node: CategoryNode;
	depth: number;
	childrenByParent: Map<string, CategoryNode[]>;
	expanded: Set<string>;
	loading: Set<string>;
	selected: string | null;
	onToggle: (node: CategoryNode) => Promise<void>;
	onSelect: (selection: { id: string; name: string }) => void;
}

function TreeItem({
	node,
	depth,
	childrenByParent,
	expanded,
	loading,
	selected,
	onToggle,
	onSelect,
}: TreeItemProps) {
	const kids = childrenByParent.get(node.id);
	const isOpen = expanded.has(node.id);
	const isLoading = loading.has(node.id);
	const isSelected = selected === node.id;
	// "Leaf" = either flagged, or already-loaded and proven empty.
	const isLeaf = node.isLeaf || (kids !== undefined && kids.length === 0);
	const indent = { paddingLeft: `${8 + depth * 14}px` };
	return (
		<li>
			<div
				className={`flex items-center gap-1 pr-2 py-1.5 rounded-[4px] text-[13px] cursor-pointer outline-none ${
					isSelected ? "text-[var(--brand)] font-medium bg-[var(--brand-soft)]" : "text-[var(--text)] hover:bg-[var(--surface-2)]"
				}`}
				style={indent}
			>
				{!isLeaf ? (
					<button
						type="button"
						aria-expanded={isOpen}
						aria-label={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
						onClick={() => void onToggle(node)}
						className="flex items-center justify-center w-4 h-4 text-[var(--text-3)] hover:text-[var(--text)] cursor-pointer"
					>
						<svg
							width="8"
							height="8"
							viewBox="0 0 10 10"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.8"
							strokeLinecap="round"
							strokeLinejoin="round"
							style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 100ms" }}
							aria-hidden="true"
						>
							<path d="m4 3 3 2-3 2z" />
						</svg>
					</button>
				) : (
					<span className="w-4 h-4" aria-hidden="true" />
				)}
				<button
					type="button"
					onClick={() => onSelect({ id: node.id, name: node.name })}
					className="flex-1 text-left px-1 cursor-pointer"
				>
					{node.name}
				</button>
			</div>
			{isOpen && kids && kids.length > 0 && (
				<ul>
					{kids.map((child) => (
						<TreeItem
							key={child.id}
							node={child}
							depth={depth + 1}
							childrenByParent={childrenByParent}
							expanded={expanded}
							loading={loading}
							selected={selected}
							onToggle={onToggle}
							onSelect={onSelect}
						/>
					))}
				</ul>
			)}
			{isOpen && isLoading && (
				<p className="text-[11px] text-[var(--text-3)] py-1" style={indent}>
					Loading…
				</p>
			)}
		</li>
	);
}
