/**
 * Evaluate listing — Decisions pillar.
 *
 * Renders inside a `ComposeCard`: input (item id / URL) + filter row
 * (look-back window, sample size cap) + output (recommendation + trace).
 * Recent runs and Quick starts live below the card.
 */

import { useEffect, useState } from "react";
import {
	ComposeCard,
	ComposeFilters,
	ComposeInput,
	ComposeOutput,
	ComposeTabs,
	type ComposeTab,
} from "../compose/ComposeCard";
import { FilterPill, type SelectOption } from "../compose/FilterPill";
import { DealFilters } from "./DealFilters";
import { EvaluateResult } from "./EvaluateResult";
import {
	EVALUATE_STEPS,
	initialSteps,
	parseItemId,
	runEvaluate,
	runEvaluateMock,
	type EvaluateOutcome,
} from "./pipelines";
import { QuickStarts, type QuickStart } from "./QuickStarts";
import { useRecentRuns, type RecentRun } from "./recent";
import { RecentRuns } from "./RecentRuns";
import type { Step } from "./types";

interface EvaluateQuery {
	input: string;
	lookbackDays: number;
	sampleLimit: number;
	minProfit: number;
	recoveryDays: number;
}

const QUICKSTART_EXAMPLES: ReadonlyArray<{ label: string; itemId: string }> = [
	{ label: "Gucci YA1264153 watch", itemId: "406338886641" },
	{ label: "Travis Scott AJ1 Mocha (sz 11)", itemId: "358471670268" },
];

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

// Min profit / Sell within / Shipping option arrays + the More-panel
// component live in ./DealFilters so Discover renders the exact same
// controls + defaults — single source of truth.

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
const IconDollar = (
	<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
		<path d="M11 5.5C11 4 9.5 3 8 3S5 4 5 5.5 6.5 7 8 7s3 1 3 2.5S9.5 12 8 12s-3-1-3-2.5" />
		<path d="M8 2v12" />
	</svg>
);
const IconHourglass = (
	<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
		<path d="M5 2h6M5 14h6" />
		<path d="M5 2c0 4 6 4 6 8s-6 4-6 8" />
		<path d="M11 2c0 4-6 4-6 8s6 4 6 8" />
	</svg>
);
const IconShip = (
	<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
		<path d="M2 6h12l-2 5H4L2 6z" />
		<path d="M5 6V3h6v3" />
	</svg>
);

export function PlaygroundEvaluate<TabId extends string = "discover" | "evaluate">({
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
	const [recoveryDays, setRecoveryDays] = useState("180");
	// More panel — detail-level cost assumptions. "" means "use server
	// default" (currently $10 shipping, $0 floor); typing a number
	// overrides per-call. The pill row keeps coarse presets; this panel
	// is for users who want to dial in a real cost model.
	const [moreOpen, setMoreOpen] = useState(false);
	const [shippingDollars, setShippingDollars] = useState("10");
	const [steps, setSteps] = useState<Step[]>(initialSteps(EVALUATE_STEPS));
	const [pending, setPending] = useState(false);
	const [outcome, setOutcome] = useState<EvaluateOutcome | null>(null);
	// Intermediate state — fills in as each step completes so the UI can
	// render whatever's available with skeletons for the rest.
	const [partial, setPartial] = useState<Partial<EvaluateOutcome>>({});
	const [err, setErr] = useState<string | null>(null);
	const [hasRun, setHasRun] = useState(false);
	const recent = useRecentRuns<EvaluateQuery>("evaluate");

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
			setErr(
				"That doesn't look like a valid eBay listing. Paste an item id (e.g. 406338886641) or any eBay listing URL.",
			);
			return;
		}
		setErr(null);
		setOutcome(null);
		setPartial({});
		setSteps(initialSteps(EVALUATE_STEPS));
		setHasRun(true);
		setPending(true);
		const lb = override?.lookbackDays ?? Number.parseInt(lookbackDays, 10);
		const sl = override?.sampleLimit ?? Number.parseInt(sampleLimit, 10);
		const mp = override?.minProfit ?? Number.parseInt(minProfit, 10);
		const rd = override?.recoveryDays ?? Number.parseInt(recoveryDays, 10);
		const shipDollars = Number.parseFloat(shippingDollars);
		const shipCents = Number.isFinite(shipDollars) && shipDollars >= 0 ? Math.round(shipDollars * 100) : undefined;
		try {
			const runner = mockMode ? runEvaluateMock : runEvaluate;
			const result = await runner(
				{
					itemId,
					lookbackDays: lb,
					sampleLimit: sl,
					minNetCents: mp > 0 ? mp * 100 : undefined, // 0 from legacy "any" preset → server default
					outboundShippingCents: shipCents,
					maxDaysToSell: rd > 0 ? rd : undefined,
				},
				(key, p) => {
					setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...p } : s)));
					if (p.status === "ok" && p.result !== undefined) {
						const r = p.result as Record<string, unknown>;
						setPartial((prev) => {
							if (key === "detail") return { ...prev, detail: p.result as EvaluateOutcome["detail"] };
							if (key === "sold")
								return {
									...prev,
									soldPool: (r.itemSales ?? r.itemSummaries ?? []) as EvaluateOutcome["soldPool"],
								};
							if (key === "active")
								return { ...prev, activePool: (r.itemSummaries ?? []) as EvaluateOutcome["activePool"] };
							if (key === "match") return { ...prev, buckets: p.result as EvaluateOutcome["buckets"] };
							if (key === "marketSummary") return { ...prev, marketSummary: p.result as EvaluateOutcome["marketSummary"] };
							if (key === "evaluate") return { ...prev, evaluation: p.result as EvaluateOutcome["evaluation"] };
							return prev;
						});
					}
				},
			);
			if (result) {
				setOutcome(result);
				const summary = result.evaluation.rating
					? `${result.evaluation.rating.toUpperCase()}${
							result.evaluation.winProbability != null
								? ` · ${Math.round(result.evaluation.winProbability * 100)}%`
								: ""
						}`
					: undefined;
				recent.add({
					id: `${itemId}|${lb}|${sl}|${mp}|${rd}`,
					mode: "evaluate",
					label: result.detail.title || itemId,
					query: {
						input: rawInput.trim(),
						lookbackDays: lb,
						sampleLimit: sl,
						minProfit: mp,
						recoveryDays: rd,
					},
					timestamp: Date.now(),
					summary,
				});
			}
		} catch (err) {
			// Anything an inner step couldn't handle (or a bug). Surface to the
			// user instead of leaving the panel pinned on "Running".
			const message = err instanceof Error ? err.message : String(err);
			setErr(`Something went wrong: ${message}`);
			setSteps((prev) =>
				prev.map((s) => (s.status === "running" ? { ...s, status: "error", error: message } : s)),
			);
		} finally {
			setPending(false);
		}
	}

	function rerunRecent(rec: RecentRun<EvaluateQuery>) {
		setInput(rec.query.input);
		setLookbackDays(String(rec.query.lookbackDays));
		setSampleLimit(String(rec.query.sampleLimit));
		setMinProfit(String(rec.query.minProfit ?? 0));
		setRecoveryDays(String(rec.query.recoveryDays ?? 0));
		void run(rec.query.input, {
			lookbackDays: rec.query.lookbackDays,
			sampleLimit: rec.query.sampleLimit,
			minProfit: rec.query.minProfit ?? 0,
			recoveryDays: rec.query.recoveryDays ?? 0,
		});
	}

	const QUICKSTARTS: ReadonlyArray<QuickStart> = QUICKSTART_EXAMPLES.map((ex) => ({
		label: ex.label,
		// Mirror Discover's behaviour: clicking a preset fills the input but
		// does not auto-run. The user reviews filters / More panel and hits
		// Run themselves. Auto-running surprised users who clicked to *see*
		// the example, not to spend a credit on it.
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
						(recoveryDays !== "180" ? 1 : 0) +
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
									<DealFilters
										value={{ minProfit, sellWithin: recoveryDays, shipping: shippingDollars }}
										onChange={(next) => {
											setMinProfit(next.minProfit);
											setRecoveryDays(next.sellWithin);
											setShippingDollars(next.shipping);
										}}
									/>
								</div>
							)}
						</>
					);
				})()}

				{(outcome || hasRun || err) && (
					<ComposeOutput>
						{err && <p className="text-[13px] text-[#c0392b] mb-3">{err}</p>}
						{hasRun && !err && (
							<EvaluateResult
								outcome={outcome ?? partial}
								steps={steps}
								sellWithinDays={Number.parseInt(recoveryDays, 10) || undefined}
								pending={pending}
							/>
						)}
					</ComposeOutput>
				)}
			</ComposeCard>

			<div className="max-w-[760px] mx-auto mt-4">
				<QuickStarts items={QUICKSTARTS} />
				<RecentRuns runs={recent.runs} onPick={rerunRecent} onClear={recent.clear} />
			</div>
		</>
	);
}

