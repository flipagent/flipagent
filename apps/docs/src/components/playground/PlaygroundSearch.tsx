/**
 * Search — flipagent's unified search panel. Hits `/v1/items/search`
 * which dispatches to Browse (active) or Marketplace Insights (sold)
 * by `?status=`. Single synchronous call (no compute job, no SSE) so
 * the runner is much smaller than Evaluate.
 *
 * Active vs Sold lives on the filter row as a Mode pill — flipping it
 * keeps the rest of the form intact so users can pivot between "what's
 * listed now" and "what actually sold" in one click. Sort is hidden on
 * sold (Marketplace Insights has no sort axis); price / condition /
 * ships-from / category / limit work in both modes.
 */

import { useEffect, useRef, useState } from "react";
import {
	ComposeCard,
	ComposeInput,
	ComposeOutput,
	ComposeTabs,
	type ComposeTab,
} from "../compose/ComposeCard";
import { playgroundApi } from "./api";
import { friendlyErrorMessage, toBannerError } from "./pipelines";
import { QuickStarts, type QuickStart } from "./QuickStarts";
import { useRecentRuns, type RecentRun } from "./recent";
import { RecentRuns } from "./RecentRuns";
import { RowDrawer } from "./RowDrawer";
import { SearchResult, type SearchOutcome } from "./SearchResult";
import {
	describeSearchQuery,
	EMPTY_SEARCH_QUERY,
	SearchFilters,
	type SearchQuery,
	searchQueryToParams,
} from "./SearchFilters";
import type { BrowseSearchResponse, ItemSummary, Step } from "./types";

export function PlaygroundSearch<TabId extends string = "search" | "discover" | "evaluate">({
	tabsProps,
}: {
	tabsProps: {
		tabs: ReadonlyArray<ComposeTab<TabId>>;
		active: TabId;
		onChange: (next: TabId) => void;
	};
}) {
	const [query, setQuery] = useState<SearchQuery>(EMPTY_SEARCH_QUERY);
	const [steps, setSteps] = useState<Step[]>([]);
	const [pending, setPending] = useState(false);
	const [outcome, setOutcome] = useState<SearchOutcome>({
		mode: "active",
		limit: EMPTY_SEARCH_QUERY.limit,
		offset: 0,
	});
	const [hasRun, setHasRun] = useState(false);
	const [err, setErr] = useState<{ message: string; upgradeUrl?: string } | null>(null);
	// Selected row → drawer. Null = drawer closed (and ComposeCard renders narrow).
	const [selected, setSelected] = useState<ItemSummary | null>(null);
	const recent = useRecentRuns<SearchQuery>("search");
	const abortRef = useRef<AbortController | null>(null);

	useEffect(() => () => abortRef.current?.abort(), []);

	// At least one of q / category / gtin must be set (the API enforces
	// the same rule). With any of those the search is well-formed.
	const hasQuery = query.q.trim().length > 0 || query.category !== null || query.gtin.trim().length > 0;
	const canRun = hasQuery && !pending;

	function patchQ(v: string) {
		setQuery((prev) => ({ ...prev, q: v }));
	}

	/**
	 * Quick-start presets fill the form AND fire the search — same
	 * pattern as `reopen` from Recent Runs. We pass `target` directly to
	 * execute() rather than relying on the post-setState `query` so the
	 * call sees the chosen preset, not whatever was in state pre-click.
	 */
	function applyAndRun(preset: Partial<SearchQuery>) {
		const target: SearchQuery = { ...EMPTY_SEARCH_QUERY, ...preset };
		setQuery(target);
		void execute(target);
	}

	function cancel() {
		abortRef.current?.abort();
		setPending(false);
	}

	async function execute(target: SearchQuery = query, offset = 0) {
		setHasRun(true);
		setErr(null);
		setPending(true);
		// Seed outcome with the request shape so SearchResult can render
		// `limit` skeleton rows + the right "Showing N–M of …" range
		// while we wait. `body` lands on success.
		setOutcome((prev) => ({
			mode: target.mode,
			limit: target.limit,
			offset,
			// On pagination (offset > 0), keep the previous body around so
			// the row table doesn't collapse to an empty state mid-fetch.
			// The skeleton still wins because we render based on `pending`.
			body: offset > 0 ? prev.body : undefined,
		}));
		const stepKey = "search";
		const params = searchQueryToParams(target, offset);
		const plan = playgroundApi.search(params);
		setSteps([
			{
				key: stepKey,
				label: target.mode === "sold" ? "Search recently-sold listings" : "Search active listings",
				status: "running",
				call: plan.call,
				requestBody: plan.requestBody,
			},
		]);

		const recentBase = {
			id: JSON.stringify(target),
			mode: "search" as const,
			label: describeSearchQuery(target),
			query: target,
		};
		recent.add({ ...recentBase, timestamp: Date.now(), status: "in_progress" });

		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;

		try {
			const res = await plan.exec();
			if (!res.ok) {
				const body = (res.body ?? null) as Record<string, unknown> | null;
				const code = typeof body?.error === "string" ? (body.error as string) : undefined;
				const rawMessage =
					typeof body?.message === "string"
						? (body.message as string)
						: res.status === 0
							? "network error"
							: `HTTP ${res.status}`;
				const friendly =
					res.status === 0
						? `Couldn't reach the API — ${rawMessage}`
						: friendlyErrorMessage(rawMessage, code, body);
				const upgradeUrl =
					typeof body?.upgrade === "string" ? (body.upgrade as string) : undefined;
				setErr({ message: friendly, ...(upgradeUrl ? { upgradeUrl } : {}) });
				setSteps((prev) =>
					prev.map((s) =>
						s.key === stepKey
							? {
									...s,
									status: "error",
									httpStatus: res.status,
									result: res.body,
									error: friendly,
									durationMs: res.durationMs,
								}
							: s,
					),
				);
				recent.add({ ...recentBase, timestamp: Date.now(), status: "failure" });
				return;
			}
			const body = res.body as BrowseSearchResponse;
			setOutcome({ mode: target.mode, limit: target.limit, offset, body });
			setSteps((prev) =>
				prev.map((s) =>
					s.key === stepKey
						? {
								...s,
								status: "ok",
								httpStatus: res.status,
								result: res.body,
								durationMs: res.durationMs,
							}
						: s,
				),
			);
			recent.add({ ...recentBase, timestamp: Date.now(), status: "success" });
		} catch (caught) {
			// fetch() throws on abort. Treat as cancellation rather than error.
			if (controller.signal.aborted) {
				recent.add({ ...recentBase, timestamp: Date.now(), status: "cancelled" });
				setSteps((prev) =>
					prev.map((s) => (s.status === "running" ? { ...s, status: "skipped" } : s)),
				);
				return;
			}
			const banner = toBannerError(caught);
			setErr(banner);
			setSteps((prev) =>
				prev.map((s) => (s.status === "running" ? { ...s, status: "error", error: banner.message } : s)),
			);
			recent.add({ ...recentBase, timestamp: Date.now(), status: "failure" });
		} finally {
			setPending(false);
		}
	}

	function reopen(rec: RecentRun<SearchQuery>) {
		setQuery(rec.query);
		void execute(rec.query);
	}

	// Reseller-grade specificity: a real model reference (not "watch"), a
	// real card + grade (not "charizard"), a real model + colorway + size
	// (not "air jordan"). Picking the SKU at this level is what separates
	// a flip search from a window-shop.
	const QUICKSTARTS: ReadonlyArray<QuickStart> = [
		{
			label: "Seiko SKX007 black dial",
			apply: () =>
				applyAndRun({
					q: "Seiko SKX007 black dial",
					category: { id: "31387", name: "Wristwatches" },
				}),
		},
		{
			label: "Sold Charizard Base Shadowless PSA 9",
			apply: () =>
				applyAndRun({
					q: "Charizard Base Set Shadowless PSA 9",
					category: { id: "183454", name: "CCG Individual Cards" },
					mode: "sold",
				}),
		},
		{
			label: "Jordan 1 Mocha size 10",
			apply: () =>
				applyAndRun({
					q: "Jordan 1 Retro High OG Mocha size 10",
					category: { id: "15709", name: "Athletic Shoes" },
				}),
		},
	];

	return (
		<>
			<ComposeCard>
				<ComposeTabs tabs={tabsProps.tabs} active={tabsProps.active} onChange={tabsProps.onChange} />
				<ComposeInput
					value={query.q}
					onChange={patchQ}
					onRun={() => execute()}
					onCancel={cancel}
					disabled={!canRun}
					pending={pending}
					placeholder='Search any SKU — e.g. "Jordan 1 Retro High OG Mocha size 10"'
				/>

				<SearchFilters value={query} onChange={setQuery} />

				{(hasRun || err) && (
					<ComposeOutput>
						{err && (
							<p className="text-[13px] text-[#c0392b] mb-3">
								{err.message}
								{err.upgradeUrl && (
									<>
										{" "}
										<a
											href={err.upgradeUrl}
											className="underline underline-offset-2 font-medium hover:opacity-80"
										>
											Upgrade →
										</a>
									</>
								)}
							</p>
						)}
						{hasRun && !err && (
							<>
								<SearchResult
									outcome={outcome}
									steps={steps}
									pending={pending}
									onPage={(nextOffset) => void execute(query, nextOffset)}
									onSelectItem={setSelected}
									selectedItemId={selected?.itemId ?? null}
								/>
								{selected && <RowDrawer item={selected} onClose={() => setSelected(null)} />}
							</>
						)}
					</ComposeOutput>
				)}
			</ComposeCard>

			<div className="max-w-[760px] mx-auto mt-4">
				<QuickStarts items={QUICKSTARTS} />
				<RecentRuns runs={recent.runs} onPick={reopen} onClear={recent.clear} />
			</div>
		</>
	);
}
