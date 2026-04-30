/**
 * Recent-runs strip below the compose box. Click a row → instantly
 * re-runs the saved query. Renders nothing when empty (no "no runs yet"
 * placeholder — silence is better than a sad-empty-state in the chat
 * UI vibe).
 */

import { timeAgo, type RecentMode, type RecentRun, type RecentStatus } from "./recent";

const STATUS_LABEL: Record<RecentStatus, string> = {
	success: "Success",
	failure: "Failed",
	cancelled: "Cancelled",
	in_progress: "In progress",
};

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
							<StatusBadge status={r.status} />
							<span className="pg-recent-time">{timeAgo(r.timestamp)}</span>
							<span className="pg-recent-arrow" aria-hidden="true">→</span>
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}

function StatusBadge({ status }: { status: RecentStatus }) {
	return (
		<span className={`pg-recent-status pg-recent-status--${status}`}>
			<span className="pg-recent-status-dot" aria-hidden="true">
				<StatusGlyph status={status} />
			</span>
			<span className="pg-recent-status-label">{STATUS_LABEL[status]}</span>
		</span>
	);
}

function StatusGlyph({ status }: { status: RecentStatus }) {
	if (status === "success") {
		return (
			<svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
				<path d="m3 8 3 3 7-7" />
			</svg>
		);
	}
	if (status === "failure") {
		return (
			<svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
				<path d="M4 4l8 8M12 4l-8 8" />
			</svg>
		);
	}
	if (status === "cancelled") {
		return (
			<svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
				<circle cx="8" cy="8" r="5.5" />
				<path d="m4 4 8 8" />
			</svg>
		);
	}
	// in_progress — empty; CSS draws a spinning ring on the dot
	return null;
}

export type { RecentMode };
