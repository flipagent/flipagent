/**
 * Evaluate listing — Decisions pillar.
 *
 * Renders inside a `ComposeCard`: input (item id / URL) + filter row
 * (look-back window, sample size cap) + output (recommendation + trace).
 * Recent runs and Quick starts live below the card.
 */

import { useEffect, useRef, useState } from "react";
import {
	ComposeCard,
	ComposeFilters,
	ComposeInput,
	ComposeOutput,
	ComposeTabs,
	type ComposeTab,
} from "../compose/ComposeCard";
import { FilterPill, type SelectOption } from "../compose/FilterPill";
import { EvaluateSettings, SELL_WITHIN_OPTIONS } from "./EvaluateSettings";
import { EvaluateResult } from "./EvaluateResult";
import {
	cancelComputeJob,
	EVALUATE_STEPS,
	type EvaluateOutcome,
	type EvaluateVariation,
	fetchJobStatus,
	friendlyErrorMessage,
	initialSteps,
	parseItemId,
	readVariationDetails,
	reopenEvaluate,
	runEvaluate,
	runEvaluateMock,
	toBannerError,
} from "./pipelines";
import { useResumeSweep } from "./useResumeSweep";
import { QuickStarts, type QuickStart } from "./QuickStarts";
import { useRecentRuns, type RecentRun } from "./recent";
import { RecentRuns } from "./RecentRuns";
import { playgroundApi } from "./api";
import type { Step } from "./types";

interface EvaluateQuery {
	input: string;
	lookbackDays: number;
	sampleLimit: number;
	minProfit: number;
	recoveryDays: number;
}

// eBay's Marketplace Insights / sold-listings page caps at ~90 days.
// Going further returns stale or empty data, so we don't expose it.
const LOOKBACK_OPTIONS: ReadonlyArray<SelectOption<string>> = [
	{ value: "30", label: "30 days" },
	{ value: "60", label: "60 days" },
	{ value: "90", label: "90 days" },
];

const SAMPLE_OPTIONS: ReadonlyArray<SelectOption<string>> = [
	{ value: "25", label: "25 sales" },
	{ value: "50", label: "50 sales" },
	{ value: "100", label: "100 sales" },
	{ value: "200", label: "200 sales" },
];

const IconClock = (
	<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
		<circle cx="8" cy="8" r="6" />
		<path d="M8 5v3.5l2 1.5" />
	</svg>
);
const IconStack = (
	<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
		<path d="M3 5l5-2 5 2-5 2-5-2z" />
		<path d="M3 8l5 2 5-2M3 11l5 2 5-2" />
	</svg>
);
const IconHourglass = (
	<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
		<path d="M4 2h8M4 14h8" />
		<path d="M4 2c0 3 4 4 4 6s-4 3-4 6" />
		<path d="M12 2c0 3-4 4-4 6s4 3 4 6" />
	</svg>
);

/**
 * Hardcoded fallback. Used (a) on first paint before
 * `/v1/evaluate/featured` resolves, and (b) in `mockMode` since the
 * mock pipeline only knows these specific itemIds. In real mode we
 * overwrite with server-curated examples sourced from real recent
 * successful runs — those become stale-resistant on their own (every
 * fresh run rotates the pool).
 */
const QUICKSTART_EXAMPLES: ReadonlyArray<{ label: string; itemId: string }> = [
	{ label: "Gucci YA1264153 watch", itemId: "388236252829" },
	{ label: "Travis Scott AJ1 Mocha (sz 4)", itemId: "127595526397" },
];

const FEATURED_LIMIT = 4;

/** Trim long titles for the chip — match brevity of the hardcoded fallbacks. */
function shortenTitle(title: string): string {
	const trimmed = title.trim().replace(/\s+/g, " ");
	if (trimmed.length <= 48) return trimmed;
	return `${trimmed.slice(0, 45).trimEnd()}…`;
}

/**
 * Build the eBay listing URL for one variation. Same form the user
 * already understands (whatever they pasted to trigger the error),
 * just with `?var=<variationId>` pinned. Sending them back through
 * the URL field — instead of jumping straight to a re-run — keeps
 * what's in the input box honest about what we're evaluating.
 */
function variationUrl(legacyId: string, variationId: string): string {
	return `https://www.ebay.com/itm/${legacyId}?var=${variationId}`;
}

function formatVariationPrice(v: EvaluateVariation): string | null {
	if (v.priceCents == null) return null;
	const dollars = v.priceCents / 100;
	if (v.currency === "USD") return `$${dollars.toFixed(2)}`;
	return `${dollars.toFixed(2)} ${v.currency}`;
}

/**
 * Compact label for a variation: comma-joined `Aspect: value` pairs,
 * size first when present (it's almost always the discriminator users
 * care about). Falls back to the bare variationId when the SKU has no
 * aspects parsed — happens occasionally on scrape when the MSKU model
 * is missing axis labels.
 */
function variationLabel(v: EvaluateVariation): string {
	if (v.aspects.length === 0) return `Variation ${v.variationId}`;
	const sorted = [...v.aspects].sort((a, b) => {
		if (a.name === "Size") return -1;
		if (b.name === "Size") return 1;
		return 0;
	});
	return sorted.map((a) => `${a.name}: ${a.value}`).join(", ");
}

function VariationPicker({
	legacyId,
	variations,
	onPick,
}: {
	legacyId: string;
	variations: ReadonlyArray<EvaluateVariation>;
	onPick: (url: string) => void;
}) {
	return (
		<div className="pg-variations">
			<div className="pg-variations-row">
				{variations.map((v) => {
					const price = formatVariationPrice(v);
					return (
						<button
							key={v.variationId}
							type="button"
							className="pg-variation"
							onClick={() => onPick(variationUrl(legacyId, v.variationId))}
						>
							<span className="pg-variation-aspects">{variationLabel(v)}</span>
							{price && <span className="pg-variation-price">{price}</span>}
						</button>
					);
				})}
			</div>
		</div>
	);
}

// Min profit / Sell within / Shipping option arrays + the More-panel
// component live in ./EvaluateSettings — Evaluate-only scoring inputs.

export function PlaygroundEvaluate<TabId extends string = "sourcing" | "evaluate">({
	tabsProps,
	seed,
	mockMode = false,
}: {
	tabsProps: {
		tabs: ReadonlyArray<ComposeTab<TabId>>;
		active: TabId;
		onChange: (next: TabId) => void;
	};
	seed?: string | null;
	/** When true, run a canned pipeline against in-memory fixtures (logged-out hero). */
	mockMode?: boolean;
}) {
	const [input, setInput] = useState("");
	const [lookbackDays, setLookbackDays] = useState("90");
	const [sampleLimit, setSampleLimit] = useState("50");
	const [minProfit, setMinProfit] = useState("10");
	const [recoveryDays, setRecoveryDays] = useState("30");
	// More panel — detail-level cost assumptions. "" means "use server
	// default" (currently $10 shipping, $0 floor); typing a number
	// overrides per-call. The pill row keeps coarse presets; this panel
	// is for users who want to dial in a real cost model.
	const [moreOpen, setMoreOpen] = useState(false);
	const [shippingDollars, setShippingDollars] = useState("10");
	const [steps, setSteps] = useState<Step[]>(initialSteps(EVALUATE_STEPS));
	const [pending, setPending] = useState(false);
	// Partial state — populated incrementally as detail / sold / active
	// step results land via the SSE stream so the result panel hydrates
	// in pieces (item hero first, then market summary, then evaluation)
	// instead of staying blank until the whole pipeline finishes.
	const [outcome, setOutcome] = useState<Partial<EvaluateOutcome>>({});
	const [err, setErr] = useState<{
		message: string;
		upgradeUrl?: string;
		// `variation_required` errors carry the enumerated SKUs so we can
		// render a picker in place of (well, below) the banner. Clicking
		// a chip rewrites the input to a variation-pinned URL and re-runs.
		variations?: ReadonlyArray<EvaluateVariation>;
		legacyId?: string;
	} | null>(null);
	const [hasRun, setHasRun] = useState(false);
	// Server-curated showcase. Empty until the fetch resolves; we render
	// the hardcoded fallback in the meantime so the "Try one" row is
	// never blank on first paint. In mockMode we never fetch — the mock
	// pipeline only knows the hardcoded itemIds.
	const [featuredExamples, setFeaturedExamples] = useState<ReadonlyArray<{ label: string; itemId: string }>>([]);
	const recent = useRecentRuns<EvaluateQuery>("evaluate");
	// Active job + abort controller. Track in refs (not state) since the
	// values are only consumed by the cancel handler / unmount cleanup —
	// no re-render needed when they change.
	const jobIdRef = useRef<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	// Drop the SSE connection when the panel unmounts. The server-side
	// job keeps running regardless — that's the whole point of the
	// queue model — so the user can come back via Recent and resubscribe.
	useEffect(() => {
		return () => {
			abortRef.current?.abort();
		};
	}, []);

	useResumeSweep("evaluate", recent);

	// Pull a fresh "Try one" pool from the server. One-shot on mount —
	// the data shifts slowly enough that polling for it would be wasted
	// requests, and re-fetching mid-session would surprise the user
	// mid-decision. Failure (offline, logged-out, 5xx) silently falls
	// through to the hardcoded fallback.
	useEffect(() => {
		if (mockMode) return;
		let cancelled = false;
		void (async () => {
			const res = await playgroundApi.featuredEvaluations(FEATURED_LIMIT).exec();
			if (cancelled) return;
			if (!res.ok) return;
			const body = res.body as { items?: Array<{ itemId: string; title: string }> } | undefined;
			const items = body?.items;
			if (!items || items.length === 0) return;
			setFeaturedExamples(items.map((it) => ({ label: shortenTitle(it.title), itemId: it.itemId })));
		})();
		return () => {
			cancelled = true;
		};
	}, [mockMode]);

	function cancel() {
		const id = jobIdRef.current;
		if (id) void cancelComputeJob("evaluate", id);
		abortRef.current?.abort();
	}

	useEffect(() => {
		if (seed && seed !== input) {
			setInput(seed);
			void run(seed);
		}
		// biome-ignore lint/correctness/useExhaustiveDependencies: re-fire only on seed change
	}, [seed]);

	async function run(
		rawInput: string,
		override?: { lookbackDays?: number; sampleLimit?: number; minProfit?: number; recoveryDays?: number },
	) {
		const itemId = parseItemId(rawInput);
		if (!itemId) {
			setErr({
				message:
					"That doesn't look like a valid eBay listing. Paste an item id (e.g. 406338886641) or any eBay listing URL.",
			});
			return;
		}
		// Logged-out + custom listing → redirect to sign-in. The mock
		// fixture is fixed regardless of itemId (GENERIC_FALLBACK), so
		// running it on arbitrary input would show fake numbers tied to a
		// listing the visitor didn't actually pick. The QUICKSTART itemIds
		// keep mock-running so the demo still works one click in.
		const isPresetItem = QUICKSTART_EXAMPLES.some((q) => q.itemId === itemId);
		if (mockMode && !isPresetItem) {
			const ret = window.location.pathname + window.location.search;
			window.location.href = `/signup/?return=${encodeURIComponent(ret)}`;
			return;
		}
		setErr(null);
		setOutcome({});
		setSteps(initialSteps(EVALUATE_STEPS));
		setHasRun(true);
		setPending(true);
		const lb = override?.lookbackDays ?? Number.parseInt(lookbackDays, 10);
		const sl = override?.sampleLimit ?? Number.parseInt(sampleLimit, 10);
		const mp = override?.minProfit ?? Number.parseInt(minProfit, 10);
		const rd = override?.recoveryDays ?? Number.parseInt(recoveryDays, 10);
		const shipDollars = Number.parseFloat(shippingDollars);
		const shipCents = Number.isFinite(shipDollars) && shipDollars >= 0 ? Math.round(shipDollars * 100) : undefined;
		const recentBase = {
			id: `${itemId}|${lb}|${sl}|${mp}|${rd}`,
			mode: "evaluate" as const,
			query: {
				input: rawInput.trim(),
				lookbackDays: lb,
				sampleLimit: sl,
				minProfit: mp,
				recoveryDays: rd,
			},
		};
		// Drop an in-progress placeholder immediately so the user sees the
		// run in the Recent strip with a spinner. The id is deterministic,
		// so the eventual success/failure entry overwrites this in place.
		// `jobId` is filled in via `onJobCreated` once the server returns
		// its row id — until then the placeholder has no jobId.
		recent.add({ ...recentBase, label: itemId, timestamp: Date.now(), status: "in_progress" });
		// Fresh abort controller per run so a stale cancel from a prior
		// attempt doesn't kill this one.
		jobIdRef.current = null;
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		// Best-known label for the Recent row. Starts as the raw item id;
		// upgrades to the listing title the moment the detail step lands
		// (mid-run, via onPartial). Final status writes pick this up so a
		// failure halfway through still shows "Gucci YA1264153 watch"
		// instead of "v1|406338886641|0".
		let label = itemId;
		try {
			const runner = mockMode ? runEvaluateMock : runEvaluate;
			const result = await runner(
				{
					itemId,
					lookbackDays: lb,
					soldLimit: sl,
					minNetCents: mp > 0 ? mp * 100 : undefined,
					outboundShippingCents: shipCents,
					maxDaysToSell: rd > 0 ? rd : undefined,
				},
				{
					onJobCreated: (id) => {
						jobIdRef.current = id;
						// Persist jobId on the in-progress placeholder so a
						// reload-then-click can resume via /jobs/{id}/stream.
						recent.update(recentBase.id, { jobId: id });
					},
					onStep: (key, p) =>
						setSteps((prev) => {
							const idx = prev.findIndex((s) => s.key === key);
							if (idx >= 0) return prev.map((s, i) => (i === idx ? { ...s, ...p } : s));
							return [...prev, { key, label: p.label ?? key, status: p.status ?? "pending", ...p }];
						}),
					onPartial: (patch) => {
						setOutcome((prev) => ({ ...prev, ...patch }));
						const title = patch.item?.title?.trim();
						if (title && title !== label) {
							label = title;
							recent.update(recentBase.id, { label });
						}
					},
				},
				controller.signal,
			);
			if (result.kind === "success") {
				setOutcome(result.value);
				const title = result.value.item.title?.trim();
				if (title) label = title;
			} else if (result.kind === "failed") {
				// Stream-level failure — surface a banner and flip every
				// still-running step row to error in one place. Doing this
				// here (not inside consumeStream) keeps step state and
				// top-level error in sync; otherwise "Search market"
				// stays spinning while only "Evaluate" shows red.
				const friendly = friendlyErrorMessage(result.message, result.code);
				const variationDetails =
					result.code === "variation_required" ? readVariationDetails(result.details) : null;
				setErr({
					message: friendly,
					...(variationDetails ? { variations: variationDetails.variations, legacyId: variationDetails.legacyId } : {}),
				});
				setSteps((prev) =>
					prev.map((s) => (s.status === "running" ? { ...s, status: "error", error: friendly } : s)),
				);
			} else if (result.kind === "cancelled") {
				// User cancelled — flip every still-running step to skipped
				// so spinners stop. Without this, the trace keeps animating
				// even though pending is false and the worker is gone.
				setSteps((prev) =>
					prev.map((s) => (s.status === "running" ? { ...s, status: "skipped" } : s)),
				);
			}
			const finalStatus =
				result.kind === "success" ? "success" : result.kind === "cancelled" ? "cancelled" : "failure";
			recent.add({
				...recentBase,
				label,
				timestamp: Date.now(),
				status: finalStatus,
				jobId: jobIdRef.current ?? undefined,
			});
		} catch (err) {
			// Pre-stream failures — `createEvaluateJob` rejecting (e.g. 429
			// credits_exceeded from middleware before a job row is created).
			// `toBannerError` rewrites the JSON envelope into a friendly
			// banner + optional upgrade URL.
			const banner = toBannerError(err);
			setErr(banner);
			setSteps((prev) =>
				prev.map((s) => (s.status === "running" ? { ...s, status: "error", error: banner.message } : s)),
			);
			recent.add({
				...recentBase,
				label,
				timestamp: Date.now(),
				status: "failure",
				jobId: jobIdRef.current ?? undefined,
			});
		} finally {
			setPending(false);
		}
	}

	/**
	 * Click handler for a Recent row. Replays the saved query into the
	 * form (so re-running with the same params is one click on Run) and
	 * reopens the saved job — `/jobs/{id}/stream` covers both flavours:
	 *  - in_progress  → live resume (existing trace + new events)
	 *  - completed    → replay the saved trace + show the saved result
	 *  - failed       → replay + surface the error
	 *  - cancelled    → replay + show the partial trace
	 *
	 * Legacy entries (created before the queue refactor) have no
	 * `jobId`; for those we fall back to a fresh run with the saved
	 * params, matching the pre-queue UX.
	 */
	function reopen(rec: RecentRun<EvaluateQuery>) {
		setInput(rec.query.input);
		setLookbackDays(String(rec.query.lookbackDays ?? 90));
		setSampleLimit(String(rec.query.sampleLimit ?? 50));
		setMinProfit(String(rec.query.minProfit ?? 0));
		setRecoveryDays(String(rec.query.recoveryDays ?? 0));

		if (!rec.jobId) {
			void run(rec.query.input, {
				lookbackDays: rec.query.lookbackDays ?? 90,
				sampleLimit: rec.query.sampleLimit ?? 50,
				minProfit: rec.query.minProfit ?? 0,
				recoveryDays: rec.query.recoveryDays ?? 0,
			});
			return;
		}

		void reopenSavedJob(rec);
	}

	async function reopenSavedJob(rec: RecentRun<EvaluateQuery>) {
		const id = rec.jobId;
		if (!id) return;
		// Pre-flight — confirm the job row still exists. If the api key
		// rotated or the row was reaped, surface that without flipping
		// Recent's saved status (a successful run from the past should
		// stay marked successful even if the data is gone).
		const exists = await fetchJobStatus("evaluate", id);
		if (!exists) {
			setErr({ message: "This run is no longer available — hit Run to re-execute with the same query." });
			setHasRun(false);
			return;
		}
		setErr(null);
		setOutcome({});
		setSteps(initialSteps(EVALUATE_STEPS));
		setHasRun(true);
		setPending(true);
		jobIdRef.current = id;
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		try {
			const result = await reopenEvaluate(
				id,
				{
					onStep: (key, p) =>
						setSteps((prev) => {
							const idx = prev.findIndex((s) => s.key === key);
							if (idx >= 0) return prev.map((s, i) => (i === idx ? { ...s, ...p } : s));
							return [...prev, { key, label: p.label ?? key, status: p.status ?? "pending", ...p }];
						}),
					onPartial: (patch) => {
						setOutcome((prev) => ({ ...prev, ...patch }));
						// Upgrade the Recent label to the listing title once the
						// detail step replays — covers reopens of rows that were
						// abandoned mid-run before detail landed the first time.
						const title = patch.item?.title?.trim();
						if (title && title !== rec.label) recent.update(rec.id, { label: title });
					},
				},
				controller.signal,
			);
			// Sync the saved Recent row to whatever the stream actually
			// delivered — covers the case where the user reopened an
			// `in_progress` row that finished (or got cancelled / failed)
			// while they had it open.
			const finalStatus =
				result.kind === "success" ? "success" : result.kind === "cancelled" ? "cancelled" : "failure";
			if (result.kind === "success") setOutcome(result.value);
			else if (result.kind === "failed") {
				const friendly = friendlyErrorMessage(result.message, result.code);
				const variationDetails =
					result.code === "variation_required" ? readVariationDetails(result.details) : null;
				setErr({
					message: friendly,
					...(variationDetails ? { variations: variationDetails.variations, legacyId: variationDetails.legacyId } : {}),
				});
				setSteps((prev) =>
					prev.map((s) => (s.status === "running" ? { ...s, status: "error", error: friendly } : s)),
				);
			} else if (result.kind === "cancelled") {
				setSteps((prev) =>
					prev.map((s) => (s.status === "running" ? { ...s, status: "skipped" } : s)),
				);
			}
			if (rec.status !== finalStatus) recent.update(rec.id, { status: finalStatus });
		} catch (err) {
			const banner = toBannerError(err);
			setErr(banner);
			setSteps((prev) =>
				prev.map((s) => (s.status === "running" ? { ...s, status: "error", error: banner.message } : s)),
			);
		} finally {
			setPending(false);
		}
	}

	// Prefer server-curated examples once they load; fall back to the
	// hardcoded list while the fetch is pending or in mockMode.
	const examples = featuredExamples.length > 0 ? featuredExamples : QUICKSTART_EXAMPLES;
	const QUICKSTARTS: ReadonlyArray<QuickStart> = examples.map((ex) => ({
		label: ex.label,
		// Click a preset → fill input, don't auto-run. The user reviews
		// filters / More panel and hits Run themselves. Auto-running
		// surprised users who clicked to *see* the example, not to spend
		// a credit on it.
		apply: () => setInput(ex.itemId),
	}));

	return (
		<>
			<ComposeCard>
				<ComposeTabs tabs={tabsProps.tabs} active={tabsProps.active} onChange={tabsProps.onChange} />
				<ComposeInput
					value={input}
					onChange={setInput}
					onRun={() => run(input)}
					onCancel={cancel}
					disabled={pending || !input.trim()}
					pending={pending}
					placeholder="Paste any /itm/ URL — or an item id like 406338886641"
				/>

				{(() => {
					// Lights the More button brand-orange + shows a count when
					// any of the panel-resident knobs are non-default. Keeps the
					// pill row honest about whether hidden settings are active.
					const moreActive =
						(minProfit !== "10" ? 1 : 0) +
						(shippingDollars !== "10" ? 1 : 0);
					return (
						<>
							<ComposeFilters>
								<FilterPill
									value={lookbackDays}
									defaultValue="90"
									options={LOOKBACK_OPTIONS}
									onChange={setLookbackDays}
									icon={IconClock}
									label="Look back"
								/>
								<FilterPill
									value={recoveryDays}
									defaultValue="30"
									options={SELL_WITHIN_OPTIONS}
									onChange={setRecoveryDays}
									icon={IconHourglass}
									label="Sell within"
								/>
								<FilterPill
									value={sampleLimit}
									defaultValue="50"
									options={SAMPLE_OPTIONS}
									onChange={setSampleLimit}
									icon={IconStack}
									label="Sample size"
								/>
								<button
									type="button"
									onClick={() => setMoreOpen((o) => !o)}
									aria-expanded={moreOpen}
									className={`flex items-center gap-1.5 h-7 px-2.5 rounded-[6px] text-[12px] border transition-colors duration-100 cursor-pointer ${
										moreActive > 0
											? "border-[var(--brand)] text-[var(--brand)] bg-[var(--brand-soft)]"
											: "border-[var(--border-faint)] text-[var(--text-3)] hover:text-[var(--text)] hover:border-[var(--border)]"
									}`}
								>
									<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
										<circle cx="4" cy="4" r="1.4" />
										<path d="M7 4h6" />
										<circle cx="11" cy="8" r="1.4" />
										<path d="M3 8h5M13 8h0" />
										<circle cx="6" cy="12" r="1.4" />
										<path d="M3 12h1M9 12h4" />
									</svg>
									More {moreActive > 0 ? `· ${moreActive}` : ""}
								</button>
							</ComposeFilters>

							{moreOpen && (
								<div className="px-5 py-4 border-b border-[var(--border-faint)] bg-[color:var(--bg-soft)]/40 max-sm:px-4">
									<EvaluateSettings
										value={{ minProfit, shipping: shippingDollars }}
										onChange={(next) => {
											setMinProfit(next.minProfit);
											setShippingDollars(next.shipping);
										}}
									/>
								</div>
							)}
						</>
					);
				})()}

				{(hasRun || err) && (
					<ComposeOutput>
						{err && (
							<>
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
								{err.variations && err.legacyId && (
									<VariationPicker
										legacyId={err.legacyId}
										variations={err.variations}
										onPick={(url) => {
											setInput(url);
											void run(url);
										}}
									/>
								)}
							</>
						)}
						{hasRun && !err && (
							<EvaluateResult
								outcome={outcome}
								steps={steps}
								sellWithinDays={Number.parseInt(recoveryDays, 10) || undefined}
								pending={pending}
								onCancel={cancel}
								onRerun={() => run(input)}
							/>
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

