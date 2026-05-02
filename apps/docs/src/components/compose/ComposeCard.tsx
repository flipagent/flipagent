/**
 * Shared "compose card" primitive — the rounded card that frames a
 * tabbed chat-style demo. Same shell on landing (HeroPipeline) and
 * inside the playground (Sourcing / Evaluate). Composition over a
 * monolithic component: caller assembles `Tabs → Input → Filters? →
 * Output` as siblings inside `ComposeCard`.
 *
 * All Tailwind / CSS-var classes match the existing landing demo so the
 * two surfaces feel like the same product. Tweak in one place, both
 * surfaces follow.
 */

import type { ReactNode } from "react";

export interface ComposeTab<Id extends string = string> {
	id: Id;
	label: string;
	icon: ReactNode;
	/** Short one-line description shown under the tab row when this tab is
	 *  active. Tells the user *when* to pick this tab (intent + endpoint),
	 *  so adjacent tabs stop blurring together. Optional. */
	caption?: ReactNode;
}

export function ComposeCard({
	children,
	className = "",
	width = "narrow",
}: {
	children: ReactNode;
	className?: string;
	/** "narrow" (default, ~760px — Evaluate / Hero) or "wide" (~1180px —
	 *  Sourcing with the side-detail panel open). Animates between states. */
	width?: "narrow" | "wide";
}) {
	const widthClass = width === "wide" ? "max-w-[1320px]" : "max-w-[760px]";
	return (
		<div
			className={`${widthClass} mx-auto mt-[10vh] ${className} transition-[max-width] duration-300 ease-out`}
		>
			<div className="border border-[var(--border)] rounded-[12px] bg-[var(--surface)] overflow-hidden text-left shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_36px_rgba(0,0,0,0.06)]">
				{children}
			</div>
		</div>
	);
}

export function ComposeTabs<Id extends string>({
	tabs,
	active,
	onChange,
}: {
	tabs: ReadonlyArray<ComposeTab<Id>>;
	active: Id;
	onChange: (next: Id) => void;
}) {
	const activeTab = tabs.find((t) => t.id === active);
	return (
		<>
			<div className="flex items-center gap-1 px-2 py-2 border-b border-[var(--border-faint)] bg-[var(--bg-soft)]">
				{tabs.map((t) => {
					const isActive = t.id === active;
					return (
						<button
							key={t.id}
							type="button"
							onClick={() => onChange(t.id)}
							className={`relative flex items-center gap-1.5 h-8 px-3 rounded-[7px] text-[12.5px] font-medium border transition-colors duration-150 cursor-pointer ${
								isActive
									? "bg-[var(--surface)] text-[var(--text)] border-[var(--border-faint)] shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
									: "border-transparent text-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--surface)]"
							}`}
						>
							<span className={isActive ? "text-[var(--brand)]" : ""}>{t.icon}</span>
							{t.label}
						</button>
					);
				})}
			</div>
			{activeTab?.caption ? (
				<div className="px-3.5 py-2 border-b border-[var(--border-faint)] text-[12px] text-[var(--text-3)] bg-[var(--surface)]">
					{activeTab.caption}
				</div>
			) : null}
		</>
	);
}

export function ComposeInput({
	value,
	onChange,
	onRun,
	onCancel,
	placeholder,
	disabled,
	pending,
}: {
	value: string;
	onChange: (v: string) => void;
	onRun: () => void;
	/** When supplied + `pending`, the Run button flips to a Cancel ✕ that fires this. */
	onCancel?: () => void;
	placeholder?: string;
	disabled?: boolean;
	pending?: boolean;
}) {
	const showCancel = Boolean(pending && onCancel);
	return (
		<div className="flex items-center gap-2 px-2.5 py-2.5 border-b border-[var(--border-faint)]">
			<div className="flex items-center pl-2 pr-1 text-[var(--text-3)] font-mono text-[14px]">›</div>
			<input
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && !disabled) onRun();
				}}
				placeholder={placeholder ?? "Ask flipagent…"}
				className="flex-1 bg-transparent text-[15px] text-[var(--text)] placeholder:text-[var(--text-4)] outline-none py-2 font-sans"
			/>
			<button
				type="button"
				onClick={showCancel ? onCancel : onRun}
				disabled={!showCancel && disabled}
				aria-label={showCancel ? "Cancel" : "Run"}
				title={showCancel ? "Cancel run" : "Run"}
				className="flex items-center justify-center w-9 h-9 rounded-[8px] bg-[var(--brand)] text-white shrink-0 transition-transform duration-100 active:scale-95 shadow-[inset_0_-4px_8px_rgba(255,0,0,0.2),0_2px_4px_rgba(255,77,0,0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
			>
				{showCancel ? (
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
						<path d="M6 6l12 12M18 6l-12 12" />
					</svg>
				) : pending ? (
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2.5"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="animate-spin"
					>
						<path d="M21 12a9 9 0 1 1-6.2-8.55" />
					</svg>
				) : (
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
						<path d="M5 12h14M13 5l7 7-7 7" />
					</svg>
				)}
			</button>
		</div>
	);
}

export function ComposeFilters({ children }: { children: ReactNode }) {
	return (
		<div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-faint)] bg-[color:var(--bg-soft)]/40 flex-wrap">
			{children}
		</div>
	);
}

export function ComposeOutput({
	children,
	minHeight = "min-h-[120px]",
}: {
	children?: ReactNode;
	minHeight?: string;
}) {
	return <div className={`px-5 py-5 ${minHeight} max-sm:px-4 max-sm:py-4`}>{children}</div>;
}
