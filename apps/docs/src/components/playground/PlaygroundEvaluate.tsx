/**
 * Evaluate one — Decisions pillar.
 *
 * Renders inside a `ComposeCard`: input (itemId / URL) + output (verdict
 * card + match summary + trace). No filters — the SKU is the query.
 * Recent runs and Quick starts live below the card.
 */

import { useEffect, useState } from "react";
import {
	ComposeCard,
	ComposeInput,
	ComposeOutput,
	ComposeTabs,
	type ComposeTab,
} from "../compose/ComposeCard";
import { EvaluateResult } from "./EvaluateResult";
import { initialSteps, parseItemId, runEvaluate, EVALUATE_STEPS } from "./pipelines";
import { QuickStarts, type QuickStart } from "./QuickStarts";
import { useRecentRuns, type RecentRun } from "./recent";
import { RecentRuns } from "./RecentRuns";
import { Trace } from "./Trace";
import type { EvaluateOutcome } from "./pipelines";
import type { Step } from "./types";

interface EvaluateQuery {
	input: string;
}

const QUICKSTART_EXAMPLES: ReadonlyArray<{ label: string; itemId: string }> = [
	{ label: "Gucci YA1264153 watch", itemId: "406338886641" },
	{ label: "Gucci YA1264155 (PVD)", itemId: "406336551572" },
];

export function PlaygroundEvaluate({
	tabsProps,
	seed,
}: {
	tabsProps: {
		tabs: ReadonlyArray<ComposeTab<"discover" | "evaluate">>;
		active: "discover" | "evaluate";
		onChange: (next: "discover" | "evaluate") => void;
	};
	seed?: string | null;
}) {
	const [input, setInput] = useState("");
	const [steps, setSteps] = useState<Step[]>(initialSteps(EVALUATE_STEPS));
	const [pending, setPending] = useState(false);
	const [outcome, setOutcome] = useState<EvaluateOutcome | null>(null);
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

	async function run(rawInput: string) {
		const itemId = parseItemId(rawInput);
		if (!itemId) {
			setErr("Couldn't parse an itemId — paste an item id, a v1|…|0 string, or any /itm/ URL.");
			return;
		}
		setErr(null);
		setOutcome(null);
		setSteps(initialSteps(EVALUATE_STEPS));
		setHasRun(true);
		setPending(true);
		try {
			const result = await runEvaluate(itemId, (key, p) =>
				setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...p } : s))),
			);
			if (result) {
				setOutcome(result);
				const summary = result.verdict.rating
					? `${result.verdict.rating.toUpperCase()}${
							result.verdict.probProfit != null ? ` · ${Math.round(result.verdict.probProfit * 100)}%` : ""
						}`
					: undefined;
				recent.add({
					id: itemId,
					mode: "evaluate",
					label: result.detail.title || itemId,
					query: { input: rawInput.trim() },
					timestamp: Date.now(),
					summary,
				});
			}
		} finally {
			setPending(false);
		}
	}

	function rerunRecent(rec: RecentRun<EvaluateQuery>) {
		setInput(rec.query.input);
		void run(rec.query.input);
	}

	const QUICKSTARTS: ReadonlyArray<QuickStart> = QUICKSTART_EXAMPLES.map((ex) => ({
		label: ex.label,
		apply: () => {
			setInput(ex.itemId);
			void run(ex.itemId);
		},
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

				{(outcome || hasRun || err) && (
					<ComposeOutput>
						{err && <p className="text-[13px] text-[#c0392b] mb-3">{err}</p>}
						{outcome ? (
							<EvaluateResult outcome={outcome} steps={steps} />
						) : (
							<Trace steps={steps} />
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

