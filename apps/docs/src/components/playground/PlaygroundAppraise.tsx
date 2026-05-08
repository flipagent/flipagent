/**
 * Playground panel — "what's this product worth" mode of `/v1/evaluate`.
 * Calls the same `/v1/evaluate` endpoint as PlaygroundEvaluate but with
 * a `query` or `external` ProductRef (no buy-decision opts) and renders
 * just the MarketView half of the response (server returns
 * `evaluation: null` for query refs). Sibling to PlaygroundEvaluate
 * which surfaces the buy-decision overlay.
 */

import { useRef, useState } from "react";
import {
	ComposeCard,
	ComposeFilters,
	ComposeInput,
	ComposeOutput,
	ComposeTabs,
	type ComposeTab,
} from "../compose/ComposeCard";
import { FilterPill, type SelectOption } from "../compose/FilterPill";
import { AppraiseResult, type AppraiseOutcome } from "./AppraiseResult";
import { playgroundApi } from "./api";
import { friendlyErrorMessage, parseItemId, toBannerError } from "./pipelines";

const LOOKBACK_OPTIONS: ReadonlyArray<SelectOption<string>> = [
	{ value: "30", label: "30 days" },
	{ value: "60", label: "60 days" },
	{ value: "90", label: "90 days" },
];

const SAMPLE_OPTIONS: ReadonlyArray<SelectOption<string>> = [
	{ value: "25", label: "25 sales" },
	{ value: "50", label: "50 sales" },
	{ value: "100", label: "100 sales" },
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

/**
 * Decide whether the user typed a marketplace listing reference (URL /
 * legacy id) or a free-text query. For URLs we send `kind: "external"`;
 * everything else goes as `kind: "query"`.
 */
function buildRef(input: string): { kind: "external"; marketplace: string; listingId: string } | { kind: "query"; q: string } {
	const parsed = parseItemId(input);
	if (parsed) return { kind: "external", marketplace: "ebay_us", listingId: input };
	return { kind: "query", q: input.trim() };
}

export function PlaygroundAppraise<TabId extends string>({
	tabsProps,
}: {
	tabsProps: {
		tabs: ReadonlyArray<ComposeTab<TabId>>;
		active: TabId;
		onChange: (next: TabId) => void;
	};
}) {
	const [input, setInput] = useState("");
	const [lookbackDays, setLookbackDays] = useState("90");
	const [sampleLimit, setSampleLimit] = useState("50");
	const [pending, setPending] = useState(false);
	const [outcome, setOutcome] = useState<AppraiseOutcome | null>(null);
	const [hasRun, setHasRun] = useState(false);
	const [err, setErr] = useState<{ message: string; upgradeUrl?: string } | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	function cancel() {
		abortRef.current?.abort();
		setPending(false);
	}

	async function run() {
		if (!input.trim()) return;
		setHasRun(true);
		setErr(null);
		setOutcome(null);
		setPending(true);
		const ref = buildRef(input);
		const lb = Number.parseInt(lookbackDays, 10);
		const sl = Number.parseInt(sampleLimit, 10);
		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		try {
			const res = await playgroundApi.evaluate({ ref, lookbackDays: lb, soldLimit: sl }).exec();
			if (!res.ok) {
				const body = (res.body ?? null) as Record<string, unknown> | null;
				const code = typeof body?.error === "string" ? (body.error as string) : undefined;
				const rawMessage =
					typeof body?.message === "string" ? (body.message as string) : `HTTP ${res.status}`;
				setErr({ message: friendlyErrorMessage(rawMessage, code, body) });
				return;
			}
			setOutcome(res.body as AppraiseOutcome);
		} catch (caught) {
			if (controller.signal.aborted) return;
			const banner = toBannerError(caught);
			setErr(banner);
		} finally {
			setPending(false);
		}
	}

	return (
		<>
			<ComposeCard>
				<ComposeTabs tabs={tabsProps.tabs} active={tabsProps.active} onChange={tabsProps.onChange} />
				<ComposeInput
					value={input}
					onChange={setInput}
					onRun={run}
					onCancel={cancel}
					disabled={pending || !input.trim()}
					pending={pending}
					placeholder='Title or eBay URL — e.g. "Seiko SKX007 black dial"'
				/>
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
				</ComposeFilters>

				{(hasRun || err) && (
					<ComposeOutput>
						{err && (
							<p style={{ fontSize: 13, color: "#c0392b", marginBottom: 12 }}>
								{err.message}
								{err.upgradeUrl && (
									<>
										{" "}
										<a href={err.upgradeUrl} style={{ textDecoration: "underline" }}>
											Upgrade →
										</a>
									</>
								)}
							</p>
						)}
						{!err && outcome && <AppraiseResult outcome={outcome} />}
						{!err && !outcome && pending && (
							<p style={{ fontSize: 13, color: "var(--text-3)" }}>Resolving catalog and pulling market data…</p>
						)}
					</ComposeOutput>
				)}
			</ComposeCard>
		</>
	);
}
