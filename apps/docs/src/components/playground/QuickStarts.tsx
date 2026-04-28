/**
 * Curated preset pills above a form. Click → preset applies (form state
 * updates), user sees what got filled, hits Run. Turns "blank form, what
 * do I type?" into "click and look, then run".
 *
 * `apply` is the only API surface — what gets set is the panel's
 * concern. We don't auto-run here, deliberately: showing the user the
 * filled state before running is the value (they learn the shape of a
 * good query, not just the answer).
 */

export interface QuickStart {
	label: string;
	apply: () => void;
}

export function QuickStarts({ items }: { items: ReadonlyArray<QuickStart> }) {
	return (
		<div className="pg-quickstarts" role="toolbar" aria-label="Try a preset">
			<span className="pg-quickstarts-label" aria-hidden="true">
				<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
					<path d="M9 2 4 9h3l-1 5 5-7H8l1-5z" />
				</svg>
				Try one
			</span>
			<div className="pg-quickstarts-row">
				{items.map((q) => (
					<button key={q.label} type="button" className="pg-quickstart" onClick={q.apply}>
						{q.label}
					</button>
				))}
			</div>
		</div>
	);
}
