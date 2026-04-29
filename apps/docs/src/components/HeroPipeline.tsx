/**
 * Landing-hero pipeline. Five outer tabs (Discover · Evaluate · Buy ·
 * Sell · Ship) wrapped in the same `ComposeCard` shell as the
 * `/dashboard` playground. Discover and Evaluate render the real
 * playground panels — when the visitor is signed in they hit the live
 * API; when logged out the panels run a canned mock pipeline that
 * traces and renders identically.
 *
 * Buy / Sell / Ship are landing-only scripted demos (the real
 * bridge/forwarder flows live in the agent / extension). They reuse
 * the same primitives — ComposeInput, ComposeFilters with FilterPills,
 * ComposeOutput, Trace, and `pg-result-*` classes — so the five tabs
 * feel like one product surface, not three "real" panels glued to
 * three "demo" panels.
 */

import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useSession } from "../lib/authClient";
import {
	ComposeCard,
	ComposeFilters,
	ComposeInput,
	ComposeOutput,
	ComposeTabs,
	type ComposeTab,
} from "./compose/ComposeCard";
import { FilterPill, type SelectOption } from "./compose/FilterPill";
import { PlaygroundDiscover } from "./playground/PlaygroundDiscover";
import { PlaygroundEvaluate } from "./playground/PlaygroundEvaluate";
import { initialSteps } from "./playground/pipelines";
import { Trace } from "./playground/Trace";
import type { Step } from "./playground/types";

type TabId = "discover" | "evaluate" | "buy" | "sell" | "ship";

const ITEM_PHOTO = "/demo/canon-50.jpg";
const ITEM_TITLE = "Canon EF 50mm f/1.8 STM · used";
const ITEM_URL = "https://www.ebay.com/itm/206202523567";
const ITEM_ID = "v1|206202523567|0";

/* ------------------------------- icons ------------------------------- */

const IconSearch = (
	<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<circle cx="11" cy="11" r="7" />
		<path d="m20 20-3.5-3.5" />
	</svg>
);
const IconGauge = (
	<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<path d="M12 14a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
		<path d="M12 4v2M4 12h2M12 20v-2M20 12h-2M5.6 5.6l1.4 1.4M16.9 7l1.5-1.4M5.6 18.4 7 17M16.9 17l1.5 1.4" />
	</svg>
);
const IconBuy = (
	<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<path d="M5 4h2l2.4 12.4a2 2 0 0 0 2 1.6h7.2a2 2 0 0 0 2-1.6L22 8H7" />
		<circle cx="10" cy="21" r="1.2" />
		<circle cx="18" cy="21" r="1.2" />
	</svg>
);
const IconSell = (
	<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<path d="M21 11V5a2 2 0 0 0-2-2h-6L3 13l8 8 10-10z" />
		<circle cx="8" cy="8" r="1.4" />
	</svg>
);
const IconShip = (
	<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<path d="M3 7h11v10H3z" />
		<path d="M14 11h5l2 3v3h-7z" />
		<circle cx="7" cy="19" r="2" />
		<circle cx="18" cy="19" r="2" />
	</svg>
);
const IconPin = (
	<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
		<path d="M8 14s5-4.5 5-9a5 5 0 0 0-10 0c0 4.5 5 9 5 9z" />
		<circle cx="8" cy="5" r="1.6" />
	</svg>
);
const IconDollar = (
	<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
		<path d="M11 5.5C11 4 9.5 3 8 3S5 4 5 5.5 6.5 7 8 7s3 1 3 2.5S9.5 12 8 12s-3-1-3-2.5" />
		<path d="M8 2v12" />
	</svg>
);
const IconBolt = (
	<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
		<path d="M9 2 4 9h3l-1 5 5-7H8l1-5z" />
	</svg>
);
const IconStore = (
	<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
		<path d="M2 6h12l-1-3H3L2 6z" />
		<path d="M3 6v7h10V6M6 13V9h4v4" />
	</svg>
);
const IconCamera = (
	<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
		<path d="M2 5h2l1-2h6l1 2h2v8H2z" />
		<circle cx="8" cy="9" r="2.5" />
	</svg>
);
const IconTag = (
	<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
		<path d="M2 8V3h5l7 7-5 5z" />
		<circle cx="5" cy="6" r="1" />
	</svg>
);
const IconTruck = (
	<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
		<path d="M1 5h9v6H1zM10 7h3l2 2v2h-5z" />
		<circle cx="4" cy="12" r="1.2" />
		<circle cx="12" cy="12" r="1.2" />
	</svg>
);
const IconShield = (
	<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
		<path d="M8 1.5 3 3v5c0 3 2 5 5 6 3-1 5-3 5-6V3z" />
	</svg>
);

const TABS: ReadonlyArray<ComposeTab<TabId>> = [
	{ id: "discover", label: "Discover", icon: IconSearch },
	{ id: "evaluate", label: "Evaluate", icon: IconGauge },
	{ id: "buy", label: "Buy", icon: IconBuy },
	{ id: "sell", label: "Sell", icon: IconSell },
	{ id: "ship", label: "Ship", icon: IconShip },
];

/* ------------------------------- shell ------------------------------- */

export default function HeroPipeline() {
	const session = useSession();
	const mockMode = !session.data?.user;

	const [active, setActive] = useState<TabId>("discover");
	const [evaluateSeed, setEvaluateSeed] = useState<string | null>(null);

	const tabsProps = useMemo(
		() => ({ tabs: TABS, active, onChange: setActive }),
		[active],
	);

	if (active === "discover") {
		return (
			<PlaygroundDiscover
				tabsProps={tabsProps}
				mockMode={mockMode}
				onEvaluate={(itemId) => {
					setEvaluateSeed(itemId);
					setActive("evaluate");
				}}
			/>
		);
	}
	if (active === "evaluate") {
		return <PlaygroundEvaluate tabsProps={tabsProps} mockMode={mockMode} seed={evaluateSeed} />;
	}
	if (active === "buy") return <BuyStage tabsProps={tabsProps} />;
	if (active === "sell") return <SellStage tabsProps={tabsProps} />;
	return <ShipStage tabsProps={tabsProps} />;
}

/* --------------------------- shared primitives --------------------------- */

interface TabsProps {
	tabs: ReadonlyArray<ComposeTab<TabId>>;
	active: TabId;
	onChange: (next: TabId) => void;
}

interface ScriptedStep {
	key: string;
	label: string;
	call: { method: "GET" | "POST"; path: string };
	result: unknown;
}

const STEP_DELAY_MS = 280;

async function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Replay a scripted step list through the Trace UI. Mirrors the
 * `mockStep` helper in pipelines.ts: emit running → resolve to ok with
 * the canned response and a measured duration.
 */
async function runScriptedDemo(
	script: ReadonlyArray<ScriptedStep>,
	setSteps: React.Dispatch<React.SetStateAction<Step[]>>,
): Promise<void> {
	for (const step of script) {
		setSteps((prev) => prev.map((s) => (s.key === step.key ? { ...s, status: "running" } : s)));
		const start = performance.now();
		await delay(STEP_DELAY_MS);
		const durationMs = Math.round(performance.now() - start);
		setSteps((prev) =>
			prev.map((s) =>
				s.key === step.key
					? { ...s, status: "ok", call: step.call, result: step.result, durationMs }
					: s,
			),
		);
	}
}

interface FactRow {
	label: string;
	value: React.ReactNode;
	aside?: string;
	tone?: "good" | "warn";
	mono?: boolean;
}

function ItemHero({ sub }: { sub: string }) {
	return (
		<a
			href={ITEM_URL}
			target="_blank"
			rel="noopener noreferrer"
			className="pg-result-hero"
		>
			<div className="pg-result-hero-thumb">
				<img src={ITEM_PHOTO} alt="" loading="lazy" />
			</div>
			<div className="pg-result-hero-body">
				<div className="pg-result-hero-title">{ITEM_TITLE}</div>
				<div className="pg-result-hero-meta">
					<span className="font-mono">{ITEM_ID}</span>
					<span>{sub}</span>
				</div>
			</div>
			<svg
				className="pg-result-hero-link"
				width="13"
				height="13"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				<path d="M9 3h4v4M13 3 7 9M7 5H4.5A1.5 1.5 0 0 0 3 6.5v5A1.5 1.5 0 0 0 4.5 13h5a1.5 1.5 0 0 0 1.5-1.5V9" />
			</svg>
		</a>
	);
}

function Facts({ rows }: { rows: ReadonlyArray<FactRow> }) {
	return (
		<dl className="pg-result-facts">
			{rows.map((r) => (
				<div key={r.label}>
					<dt>{r.label}</dt>
					<dd>
						<span
							className={`pg-result-facts-val${
								r.tone === "good"
									? " pg-result-facts-val--good"
									: r.tone === "warn"
										? " pg-result-facts-val--warn"
										: ""
							}${r.mono ? " font-mono" : ""}`}
						>
							{r.value}
						</span>
						{r.aside && <span className="pg-result-facts-aside">{r.aside}</span>}
					</dd>
				</div>
			))}
		</dl>
	);
}

function Recommendation({
	prefix,
	rating,
	tone = "good",
	lines,
}: {
	prefix: string;
	rating: string;
	tone?: "good" | "warn" | "neutral";
	lines: ReadonlyArray<string>;
}) {
	return (
		<section className="pg-result-rec">
			<div className="pg-result-rec-line-prim">
				<span className="pg-result-rec-prefix">{prefix}</span>
				<span className={`pg-result-rec-rating pg-result-rec-rating--${tone}`}>{rating}</span>
			</div>
			{lines.map((l) => (
				<p key={l} className="pg-result-rec-line">
					{l}
				</p>
			))}
		</section>
	);
}

/**
 * Sits between the outer tab strip and the input on the demo-only
 * stages (Buy / Sell / Ship). The Discover and Evaluate tabs are real
 * — these three are scripted previews until bridge order execution,
 * publish, and forwarder dispatch ship.
 */
function PreviewBadge({ caption }: { caption: string }) {
	return (
		<div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border-faint)] bg-[color:var(--brand-soft)]/45">
			<svg
				width="11"
				height="11"
				viewBox="0 0 16 16"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.6"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
				className="text-[var(--brand)]"
			>
				<circle cx="8" cy="8" r="6" />
				<path d="M8 5.5v3M8 11v.01" />
			</svg>
			<span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--brand)]">
				Preview
			</span>
			<span className="text-[11.5px] text-[var(--text-3)]">{caption}</span>
		</div>
	);
}

function Footer({ payload, steps }: { payload: unknown; steps: Step[] }) {
	const [open, setOpen] = useState(false);
	const [copied, setCopied] = useState(false);
	async function copy() {
		try {
			await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			/* ignore */
		}
	}
	return (
		<div className="pg-result-foot">
			<div className="pg-result-foot-row">
				<button type="button" onClick={copy} className="pg-result-copy">
					<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
						<rect x="5" y="5" width="9" height="9" rx="1.5" />
						<path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
					</svg>
					{copied ? "Copied" : "Copy JSON"}
				</button>
				<button type="button" className="pg-result-trace-toggle" onClick={() => setOpen((o) => !o)}>
					<svg
						width="9"
						height="9"
						viewBox="0 0 10 10"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.6"
						strokeLinecap="round"
						strokeLinejoin="round"
						className={open ? "rotate-180" : ""}
						style={{ transition: "transform 150ms ease" }}
					>
						<path d="m3 4 2 2 2-2" />
					</svg>
					{open ? "Hide trace" : "Show trace"}
				</button>
			</div>
			{open && (
				<div className="pg-result-trace-body">
					<Trace steps={steps} />
				</div>
			)}
		</div>
	);
}

/* ----------------------------- buy stage ----------------------------- */

const FORWARDER_OPTIONS: ReadonlyArray<SelectOption<string>> = [
	{ value: "planet_express", label: "Planet Express · OR" },
	{ value: "stackry", label: "Stackry · NH (soon)" },
	{ value: "myus", label: "MyUS · FL (soon)" },
	{ value: "direct", label: "Ship direct" },
];

const MAX_BID_OPTIONS: ReadonlyArray<SelectOption<string>> = [
	{ value: "auto", label: "Auto (median × 0.55)" },
	{ value: "40", label: "$40" },
	{ value: "45", label: "$45" },
	{ value: "50", label: "$50" },
];

const AUTO_ACCEPT_OPTIONS: ReadonlyArray<SelectOption<string>> = [
	{ value: "on", label: "On" },
	{ value: "off", label: "Off" },
];

function forwarderLabel(value: string): string {
	return FORWARDER_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

function maxBidCents(value: string): number {
	if (value === "auto") return 4000;
	const n = Number.parseFloat(value);
	return Number.isFinite(n) ? Math.round(n * 100) : 4000;
}

function BuyStage({ tabsProps }: { tabsProps: TabsProps }) {
	const [forwarder, setForwarder] = useState("planet_express");
	const [maxBid, setMaxBid] = useState("auto");
	const [autoAccept, setAutoAccept] = useState("on");
	const [input, setInput] = useState("Buy this Canon at the auto-bid ceiling, route through Planet Express OR.");

	const script = useMemo<ScriptedStep[]>(() => {
		const ceiling = maxBidCents(maxBid);
		return [
			{
				key: "detail",
				label: "Look up the listing",
				call: { method: "GET", path: `/v1/listings/${encodeURIComponent(ITEM_ID)}` },
				result: {
					itemId: ITEM_ID,
					title: ITEM_TITLE,
					price: { value: "42.00", currency: "USD" },
					sellerLocation: { country: "US", state: "OR" },
					itemWebUrl: ITEM_URL,
				},
			},
			{
				key: "address",
				label: "Resolve forwarder address",
				call: { method: "GET", path: `/v1/ship/providers?forwarder=${forwarder}` },
				result: {
					forwarderAddressId: `fwd_${forwarder}_us_west`,
					name: forwarderLabel(forwarder).split(" · ")[0],
					address: { country: "US", region: forwarder === "stackry" ? "NH" : forwarder === "myus" ? "FL" : "OR" },
				},
			},
			{
				key: "offer",
				label: "Place offer (auto-accept)",
				call: { method: "POST", path: "/v1/orders" },
				result: {
					orderId: "ord_buy_8x21q",
					status: "submitted",
					offerCents: 4000,
					maxBidCents: ceiling,
					autoAccept: autoAccept === "on",
				},
			},
			{
				key: "payment",
				label: "Confirm payment",
				call: { method: "POST", path: "/v1/finance/payments" },
				result: {
					paymentId: "pay_ftq42",
					chargedCents: 4000,
					method: "stored_card",
					processor: "stripe",
				},
			},
			{
				key: "intake",
				label: "Queue forwarder intake",
				call: { method: "POST", path: "/v1/ship/quote" },
				result: {
					forwarderAddressId: `fwd_${forwarder}_us_west`,
					expectedArrival: "2026-05-04",
					trackingHint: "USPS Ground · seller dispatch",
				},
			},
		];
	}, [forwarder, maxBid, autoAccept]);

	const stage = useDemoStage(script);

	const facts: FactRow[] = [
		{ label: "Bid → paid", value: "$42.00 → $40.00", mono: true, aside: autoAccept === "on" ? "auto-accepted" : "manual" },
		{ label: "Max bid", value: maxBid === "auto" ? "$45 (auto)" : `$${maxBid}`, mono: true },
		{ label: "Forwarder", value: forwarderLabel(forwarder).split(" · ")[0], aside: forwarderLabel(forwarder).split(" · ")[1] },
		{ label: "Cost basis", value: "$40.00 + intake", mono: true, aside: "before listing" },
		{ label: "Expected arrival", value: "2026-05-04", aside: "~3 days" },
	];

	return (
		<ComposeCard>
			<ComposeTabs tabs={tabsProps.tabs} active={tabsProps.active} onChange={tabsProps.onChange} />
			<PreviewBadge caption="Not yet executable. Coming soon." />
			<ComposeInput
				value={input}
				onChange={setInput}
				onRun={stage.run}
				disabled={stage.pending}
				pending={stage.pending}
				placeholder="Tell flipagent what to buy and how to ship it"
			/>
			<ComposeFilters>
				<FilterPill
					value={forwarder}
					defaultValue="planet_express"
					options={FORWARDER_OPTIONS}
					onChange={setForwarder}
					icon={IconPin}
					label="Forwarder"
				/>
				<FilterPill
					value={maxBid}
					defaultValue="auto"
					options={MAX_BID_OPTIONS}
					onChange={setMaxBid}
					icon={IconDollar}
					label="Max bid"
				/>
				<FilterPill
					value={autoAccept}
					defaultValue="on"
					options={AUTO_ACCEPT_OPTIONS}
					onChange={setAutoAccept}
					icon={IconBolt}
					label="Auto-accept"
				/>
			</ComposeFilters>

			{(stage.outcome || stage.hasRun) && (
				<ComposeOutput>
					{stage.outcome ? (
						<motion.div
							className="pg-result"
							initial={{ opacity: 0, y: 4 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.25 }}
						>
							<ItemHero sub={`forwarder ${forwarderLabel(forwarder).split(" · ")[0]}`} />
							<Facts rows={facts} />
							<Recommendation
								prefix="Status"
								rating="ORDERED"
								tone="good"
								lines={[
									autoAccept === "on"
										? "Offer placed and auto-accepted at $40."
										: "Offer placed at $40. Awaiting seller acceptance.",
									`Inbound to ${forwarderLabel(forwarder).split(" · ")[0]}; intake scheduled.`,
								]}
							/>
							<Footer payload={stage.payload} steps={stage.steps} />
						</motion.div>
					) : (
						<Trace steps={stage.steps} />
					)}
				</ComposeOutput>
			)}
		</ComposeCard>
	);
}

/* ----------------------------- sell stage ----------------------------- */

const MARKETPLACE_OPTIONS: ReadonlyArray<SelectOption<string>> = [
	{ value: "ebay_us", label: "eBay US" },
	{ value: "ebay_uk", label: "eBay UK" },
	{ value: "ebay_de", label: "eBay DE" },
];

const LIST_AT_OPTIONS: ReadonlyArray<SelectOption<string>> = [
	{ value: "median", label: "Median ($87)" },
	{ value: "p25", label: "p25 · sells fast ($69)" },
	{ value: "p75", label: "p75 · patient ($104)" },
];

const PHOTOS_OPTIONS: ReadonlyArray<SelectOption<string>> = [
	{ value: "forwarder", label: "Forwarder photos" },
	{ value: "self", label: "Self-supplied" },
	{ value: "ai", label: "AI staged" },
];

const LIST_AT_CENTS: Record<string, number> = { median: 8700, p25: 6900, p75: 10400 };

function SellStage({ tabsProps }: { tabsProps: TabsProps }) {
	const [marketplace, setMarketplace] = useState("ebay_us");
	const [listAt, setListAt] = useState("median");
	const [photos, setPhotos] = useState("forwarder");
	const [input, setInput] = useState("List the Canon at market once it lands at the forwarder.");

	const script = useMemo<ScriptedStep[]>(() => {
		const priceCents = LIST_AT_CENTS[listAt] ?? 8700;
		return [
			{
				key: "intake",
				label: "Forwarder intake",
				call: { method: "GET", path: "/v1/ship/inventory?status=received" },
				result: {
					inventoryId: "inv_canon_50_001",
					receivedAt: "2026-04-30T13:11Z",
					condition: "USED_GOOD",
					photos: photos === "forwarder" ? 8 : photos === "self" ? 0 : 8,
				},
			},
			{
				key: "sold",
				label: "Find recent sales",
				call: { method: "GET", path: "/v1/sold/search?q=canon+ef+50mm+1.8&limit=200" },
				result: {
					itemSales: [],
					total: 247,
					summary: { medianCents: 8700, p25Cents: 6900, p75Cents: 10400, sample: 247 },
				},
			},
			{
				key: "thesis",
				label: "Calculate market price",
				call: { method: "POST", path: "/v1/research/thesis" },
				result: {
					listPriceAdvice: {
						listPriceCents: priceCents,
						sellProb14d: listAt === "p25" ? 0.78 : listAt === "p75" ? 0.21 : 0.52,
						expectedDaysToSell: listAt === "p25" ? 7 : listAt === "p75" ? 32 : 14,
					},
				},
			},
			{
				key: "publish",
				label: "Publish listing",
				call: { method: "POST", path: "/v1/listings" },
				result: {
					listingId: "lst_d24fa",
					marketplace,
					url: marketplace === "ebay_us"
						? "https://www.ebay.com/itm/408517…"
						: marketplace === "ebay_uk"
							? "https://www.ebay.co.uk/itm/408517…"
							: "https://www.ebay.de/itm/408517…",
					status: "live",
					priceCents,
				},
			},
			{
				key: "sold_event",
				label: "Sale event received",
				call: { method: "POST", path: "/v1/webhooks/marketplace" },
				result: {
					event: "order.paid",
					orderId: "ord_1f9c",
					buyerLocation: { country: "US", state: "NJ" },
					salePriceCents: priceCents,
					paidAt: "2026-04-26T18:14Z",
				},
			},
		];
	}, [marketplace, listAt, photos]);

	const stage = useDemoStage(script);

	const priceCents = LIST_AT_CENTS[listAt] ?? 8700;
	const feeCents = Math.round(priceCents * 0.1325);
	const intakeCents = 400;
	const costCents = 4000;
	const netCents = priceCents - feeCents - intakeCents - costCents;
	const roiPct = Math.round((netCents / costCents) * 100);

	const facts: FactRow[] = [
		{ label: "Listed at", value: `$${(priceCents / 100).toFixed(2)}`, mono: true, aside: listAt === "median" ? "median" : listAt === "p25" ? "p25 (fast)" : "p75 (patient)" },
		{ label: "Marketplace", value: MARKETPLACE_OPTIONS.find((o) => o.value === marketplace)?.label ?? "eBay US" },
		{ label: "Photos", value: PHOTOS_OPTIONS.find((o) => o.value === photos)?.label ?? "Forwarder" },
		{ label: "Engagement", value: "41 watchers · 2 questions" },
		{ label: "Sold to", value: "Newark, NJ" },
		{ label: "Sale price", value: `$${(priceCents / 100).toFixed(2)}`, mono: true },
		{ label: "eBay fees", value: `−$${(feeCents / 100).toFixed(2)}`, mono: true, aside: "13.25%" },
		{ label: "Forwarder", value: `−$${(intakeCents / 100).toFixed(2)}`, mono: true, aside: "intake/repack" },
		{ label: "Cost basis", value: `−$${(costCents / 100).toFixed(2)}`, mono: true },
		{ label: "Net", value: `+$${(netCents / 100).toFixed(2)}`, mono: true, tone: "good", aside: `${roiPct}% on cost` },
	];

	return (
		<ComposeCard>
			<ComposeTabs tabs={tabsProps.tabs} active={tabsProps.active} onChange={tabsProps.onChange} />
			<PreviewBadge caption="Not yet executable. Coming soon." />
			<ComposeInput
				value={input}
				onChange={setInput}
				onRun={stage.run}
				disabled={stage.pending}
				pending={stage.pending}
				placeholder="Describe how you want it listed"
			/>
			<ComposeFilters>
				<FilterPill
					value={marketplace}
					defaultValue="ebay_us"
					options={MARKETPLACE_OPTIONS}
					onChange={setMarketplace}
					icon={IconStore}
					label="Marketplace"
				/>
				<FilterPill
					value={listAt}
					defaultValue="median"
					options={LIST_AT_OPTIONS}
					onChange={setListAt}
					icon={IconTag}
					label="List at"
				/>
				<FilterPill
					value={photos}
					defaultValue="forwarder"
					options={PHOTOS_OPTIONS}
					onChange={setPhotos}
					icon={IconCamera}
					label="Photos"
				/>
			</ComposeFilters>

			{(stage.outcome || stage.hasRun) && (
				<ComposeOutput>
					{stage.outcome ? (
						<motion.div
							className="pg-result"
							initial={{ opacity: 0, y: 4 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.25 }}
						>
							<ItemHero sub={`listed $${(priceCents / 100).toFixed(0)} · 247 comps`} />
							<Facts rows={facts} />
							<Recommendation
								prefix="Outcome"
								rating={`NET +$${(netCents / 100).toFixed(0)}`}
								tone="good"
								lines={[
									listAt === "p25"
										? "Priced at p25 and sold within 7 days as expected."
										: listAt === "p75"
											? "Priced at p75; patient strategy paid off after 32 days."
											: "Priced at the median and sold within 14 days.",
									`Reconciled to ${roiPct}% return on cost basis.`,
								]}
							/>
							<Footer payload={stage.payload} steps={stage.steps} />
						</motion.div>
					) : (
						<Trace steps={stage.steps} />
					)}
				</ComposeOutput>
			)}
		</ComposeCard>
	);
}

/* ----------------------------- ship stage ----------------------------- */

const SERVICE_OPTIONS: ReadonlyArray<SelectOption<string>> = [
	{ value: "usps_priority", label: "USPS Priority" },
	{ value: "usps_ground", label: "USPS Ground Advantage" },
	{ value: "ups_ground", label: "UPS Ground" },
];

const INSURANCE_OPTIONS: ReadonlyArray<SelectOption<string>> = [
	{ value: "0", label: "None" },
	{ value: "50", label: "$50" },
	{ value: "100", label: "$100" },
	{ value: "200", label: "$200" },
];

const SERVICE_COST: Record<string, number> = {
	usps_priority: 945,
	usps_ground: 712,
	ups_ground: 1185,
};

const SERVICE_LABEL: Record<string, string> = {
	usps_priority: "USPS Priority",
	usps_ground: "USPS Ground Advantage",
	ups_ground: "UPS Ground",
};

function ShipStage({ tabsProps }: { tabsProps: TabsProps }) {
	const [forwarder, setForwarder] = useState("planet_express");
	const [service, setService] = useState("usps_priority");
	const [insurance, setInsurance] = useState("0");
	const [input, setInput] = useState("Ship the Canon to the buyer in Newark, NJ.");

	const script = useMemo<ScriptedStep[]>(() => {
		const labelCents = SERVICE_COST[service] ?? 945;
		const insuranceCents = Number.parseInt(insurance, 10) > 0 ? Math.round(Number.parseInt(insurance, 10) * 0.04 * 100) : 0;
		return [
			{
				key: "pull",
				label: "Pull from forwarder inventory",
				call: { method: "POST", path: `/v1/ship/inventory/pickup?forwarder=${forwarder}` },
				result: {
					forwarder: forwarderLabel(forwarder).split(" · ")[0],
					sku: "canon_ef_50mm_001",
					packagedAt: "2026-04-29T14:02Z",
				},
			},
			{
				key: "label",
				label: "Print shipping label",
				call: { method: "POST", path: "/v1/ship/quote" },
				result: {
					carrier: service.startsWith("usps") ? "USPS" : "UPS",
					service: SERVICE_LABEL[service],
					labelCents,
					insuranceCents,
					trackingNumber: "9405 5036 9930 0123 4567 89",
				},
			},
			{
				key: "pickup",
				label: "Carrier pickup",
				call: { method: "POST", path: "/v1/ship/track" },
				result: {
					stage: "picked_up",
					at: "PDX hub",
					ts: "2026-04-29T17:10Z",
				},
			},
			{
				key: "transit",
				label: "In transit",
				call: { method: "GET", path: "/v1/ship/track" },
				result: {
					stage: "in_transit",
					lastScan: "Salt Lake City, UT",
					ts: "2026-04-30T08:45Z",
				},
			},
			{
				key: "delivered",
				label: "Delivery scan",
				call: { method: "GET", path: "/v1/ship/track" },
				result: {
					stage: "delivered",
					at: "Newark, NJ · signed",
					ts: "2026-05-01T10:27Z",
				},
			},
		];
	}, [forwarder, service, insurance]);

	const stage = useDemoStage(script);

	const labelCents = SERVICE_COST[service] ?? 945;
	const insuranceFlat = Number.parseInt(insurance, 10);
	const insuranceCents = insuranceFlat > 0 ? Math.round(insuranceFlat * 4) : 0;
	const facts: FactRow[] = [
		{ label: "Forwarder", value: forwarderLabel(forwarder).split(" · ")[0], aside: forwarderLabel(forwarder).split(" · ")[1] },
		{ label: "Service", value: SERVICE_LABEL[service] ?? "USPS Priority" },
		{ label: "Label cost", value: `$${(labelCents / 100).toFixed(2)}`, mono: true, aside: "buyer-paid" },
		{ label: "Insurance", value: insuranceFlat > 0 ? `$${insuranceFlat} cover · $${(insuranceCents / 100).toFixed(2)}` : "None", mono: insuranceFlat > 0 },
		{ label: "Tracking", value: "9405 5036 9930 0123 4567 89", mono: true },
		{ label: "Origin → destination", value: "Tigard, OR → Newark, NJ" },
	];

	return (
		<ComposeCard>
			<ComposeTabs tabs={tabsProps.tabs} active={tabsProps.active} onChange={tabsProps.onChange} />
			<PreviewBadge caption="Not yet executable. Coming soon." />
			<ComposeInput
				value={input}
				onChange={setInput}
				onRun={stage.run}
				disabled={stage.pending}
				pending={stage.pending}
				placeholder="Tell flipagent how to ship the order"
			/>
			<ComposeFilters>
				<FilterPill
					value={forwarder}
					defaultValue="planet_express"
					options={FORWARDER_OPTIONS}
					onChange={setForwarder}
					icon={IconPin}
					label="Forwarder"
				/>
				<FilterPill
					value={service}
					defaultValue="usps_priority"
					options={SERVICE_OPTIONS}
					onChange={setService}
					icon={IconTruck}
					label="Service"
				/>
				<FilterPill
					value={insurance}
					defaultValue="0"
					options={INSURANCE_OPTIONS}
					onChange={setInsurance}
					icon={IconShield}
					label="Insurance"
				/>
			</ComposeFilters>

			{(stage.outcome || stage.hasRun) && (
				<ComposeOutput>
					{stage.outcome ? (
						<motion.div
							className="pg-result"
							initial={{ opacity: 0, y: 4 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.25 }}
						>
							<ItemHero sub="USPS 9405 5036 9930 0123 4567 89" />
							<Facts rows={facts} />
							<ShipTimeline />
							<Recommendation
								prefix="Status"
								rating="DELIVERED"
								tone="good"
								lines={[
									`Picked up from ${forwarderLabel(forwarder).split(" · ")[0]} on Apr 29 · delivered May 1.`,
									"Marketplace fulfillment synced; payout queued.",
								]}
							/>
							<Footer payload={stage.payload} steps={stage.steps} />
						</motion.div>
					) : (
						<Trace steps={stage.steps} />
					)}
				</ComposeOutput>
			)}
		</ComposeCard>
	);
}

function ShipTimeline() {
	const stages = [
		{ stage: "Pulled", at: "Planet Express · OR", time: "04-29 14:02", state: "done" as const },
		{ stage: "Picked up", at: "PDX hub", time: "04-29 17:10", state: "done" as const },
		{ stage: "In transit", at: "Salt Lake City · sort", time: "04-30 08:45", state: "done" as const },
		{ stage: "Delivered", at: "Newark, NJ · signed", time: "05-01 10:27", state: "active" as const },
	];
	return (
		<div className="mt-3 border border-[var(--border-faint)] rounded-[6px] overflow-hidden text-[13px]">
			{stages.map((r, i, arr) => (
				<motion.div
					key={r.stage}
					initial={{ opacity: 0, y: 3 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.05 + i * 0.05, duration: 0.18 }}
					className={`grid grid-cols-[18px_1fr_auto] items-center gap-x-3 px-3.5 py-2.5 ${
						i < arr.length - 1 ? "border-b border-[var(--border-faint)]" : ""
					}`}
				>
					<div className="flex items-center justify-center">
						{r.state === "active" ? (
							<span className="relative flex w-2 h-2">
								<span className="absolute inset-0 rounded-full bg-[var(--brand)] fc-pulse" />
								<span className="relative w-2 h-2 rounded-full bg-[var(--brand)]" />
							</span>
						) : (
							<span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]" />
						)}
					</div>
					<div className="flex items-baseline gap-2">
						<span className={r.state === "active" ? "font-medium text-[var(--text)]" : "text-[var(--text-2)]"}>
							{r.stage}
						</span>
						<span className="font-mono text-[11.5px] text-[var(--text-3)]">{r.at}</span>
					</div>
					<div className="font-mono text-[11px] text-[var(--text-4)] tracking-[0.04em]">{r.time}</div>
				</motion.div>
			))}
		</div>
	);
}

/* --------------------------- demo stage hook --------------------------- */

interface DemoStageState {
	steps: Step[];
	pending: boolean;
	hasRun: boolean;
	outcome: boolean;
	payload: unknown;
	run: () => Promise<void>;
}

function useDemoStage(script: ReadonlyArray<ScriptedStep>): DemoStageState {
	const [steps, setSteps] = useState<Step[]>(() => initialSteps(script));
	const [pending, setPending] = useState(false);
	const [hasRun, setHasRun] = useState(false);
	const [outcome, setOutcome] = useState(false);

	useEffect(() => {
		// Script identity changes when a filter changes — reset to a clean
		// pending state so the user re-runs with the new options.
		setSteps(initialSteps(script));
		setOutcome(false);
		setHasRun(false);
		setPending(false);
	}, [script]);

	async function run() {
		setHasRun(true);
		setOutcome(false);
		setSteps(initialSteps(script));
		setPending(true);
		try {
			await runScriptedDemo(script, setSteps);
			setOutcome(true);
		} finally {
			setPending(false);
		}
	}

	const payload = useMemo(
		() => Object.fromEntries(script.map((s) => [s.key, s.result])),
		[script],
	);

	return { steps, pending, hasRun, outcome, payload, run };
}
