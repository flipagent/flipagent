/**
 * Recent-runs strip below the compose box. Click a row → instantly
 * re-runs the saved query. Renders nothing when empty (no "no runs yet"
 * placeholder — silence is better than a sad-empty-state in the chat
 * UI vibe).
 */

import { timeAgo, type RecentRun, type RecentMode } from "./recent";

export function RecentRuns<Q>({
	runs,
	onPick,
	onClear,
}: {
	runs: ReadonlyArray<RecentRun<Q>>;
	onPick: (run: RecentRun<Q>) => void;
	onClear?: () => void;
}) {
	if (runs.length === 0) return null;
	return (
		<section className="pg-recent" aria-label="Recent runs">
			<header className="pg-recent-head">
				<span className="pg-recent-title">Recent</span>
				{onClear && (
					<button type="button" className="pg-recent-clear" onClick={onClear}>
						Clear
					</button>
				)}
			</header>
			<ul className="pg-recent-list">
				{runs.map((r) => (
					<li key={r.id}>
						<button type="button" className="pg-recent-row" onClick={() => onPick(r)}>
							<span className="pg-recent-label">{r.label}</span>
							{r.summary && <span className="pg-recent-summary">{r.summary}</span>}
							<span className="pg-recent-time">{timeAgo(r.timestamp)}</span>
							<span className="pg-recent-arrow" aria-hidden="true">→</span>
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}

export type { RecentMode };
