import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

type SceneId = "source" | "buy" | "sell" | "ship";

interface TraceLine {
	type: "call" | "ok";
	text: string;
}

interface Scene {
	id: SceneId;
	label: string;
	icon: React.ReactNode;
	prompt: string;
	traces: TraceLine[];
	render: () => React.ReactNode;
}

// One item, four stages — Canon EF 50mm f/1.8 STM threads through Source → Buy → Sell → Ship.
// Photo: Geognerd, Wikimedia Commons, CC BY-SA 4.0.
const ITEM_PHOTO = "/demo/canon-50.jpg";
const ITEM_TITLE = "Canon EF 50mm f/1.8 STM · used";

function ItemHero({ sub }: { sub: string }) {
	return (
		<div className="flex items-center gap-3 px-3.5 py-2.5 border-b border-[var(--border-faint)] bg-[var(--bg-soft)]">
			<div className="w-12 h-12 rounded-[4px] overflow-hidden border border-[var(--border-faint)] bg-white shrink-0">
				<img src={ITEM_PHOTO} alt="" className="w-full h-full object-cover" loading="lazy" />
			</div>
			<div className="flex-1 min-w-0">
				<div className="font-medium text-[13px] text-[var(--text)] truncate">{ITEM_TITLE}</div>
				<div className="font-mono text-[11px] text-[var(--text-3)] mt-0.5 truncate">{sub}</div>
			</div>
		</div>
	);
}

const IconSearch = (
	<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<circle cx="11" cy="11" r="7" />
		<path d="m20 20-3.5-3.5" />
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

const SCENES: Scene[] = [
	{
		id: "source",
		label: "Source",
		icon: IconSearch,
		prompt: "Find Canon 50mm 1.8 deals with at least 30% upside after fees",
		traces: [
			{ type: "call", text: "ebay_sold_search · canon ef 50mm 1.8 · 90d" },
			{ type: "ok", text: "247 sales · median $87 · p25 $69" },
			{ type: "call", text: "ebay_search · 1,840 active · score" },
			{ type: "ok", text: "14 listings clear the 30% bar" },
		],
		render: () => (
			<div>
				<div className="text-[13.5px] text-[var(--text)] mb-3 leading-[1.55]">
					Top 3 right now — net is buy price after eBay fees and forwarder.
				</div>
				<div className="border border-[var(--border)] rounded-[6px] overflow-hidden">
					<motion.div
						initial={{ opacity: 0, y: 4 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: 0.05, duration: 0.2 }}
						className="grid grid-cols-[40px_1fr_auto_auto_auto] gap-x-3 items-center px-3 py-2.5 text-[13px] border-b border-[var(--border-faint)]"
					>
						<div className="w-10 h-10 rounded-[4px] overflow-hidden border border-[var(--border-faint)] bg-white">
							<img src={ITEM_PHOTO} alt="" className="w-full h-full object-cover" loading="eager" />
						</div>
						<div className="min-w-0">
							<div className="font-medium text-[var(--text)] truncate">{ITEM_TITLE}</div>
							<div className="font-mono text-[10px] text-[var(--brand)] tracking-[0.08em] uppercase mt-0.5">
								Top pick · 247 comps
							</div>
						</div>
						<div className="font-mono text-[12px] text-[var(--text-3)]">
							$42 <span className="text-[var(--text-4)]">→</span> $87
						</div>
						<div className="font-mono text-[12.5px] font-semibold text-[var(--success)]">+$31</div>
						<div className="font-mono text-[11px] text-[var(--brand)] tracking-[0.04em] uppercase">74%</div>
					</motion.div>
					{[
						{ title: "Canon FD 50mm f/1.8 · MINT", buy: "$49", sell: "$92", net: "+$30", roi: "61%" },
						{ title: "Canon EF 50mm f/1.8 II · used", buy: "$61", sell: "$95", net: "+$23", roi: "38%" },
					].map((d, i, arr) => (
						<motion.div
							key={d.title}
							initial={{ opacity: 0, y: 4 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.11 + i * 0.06, duration: 0.2 }}
							className={`grid grid-cols-[40px_1fr_auto_auto_auto] gap-x-3 items-center px-3 py-2.5 text-[13px] ${
								i < arr.length - 1 ? "border-b border-[var(--border-faint)]" : ""
							}`}
						>
							<div className="w-10 h-10 rounded-[4px] bg-[var(--bg-soft)] border border-[var(--border-faint)]" />
							<div className="font-medium text-[var(--text-2)] truncate">{d.title}</div>
							<div className="font-mono text-[12px] text-[var(--text-3)]">
								{d.buy} <span className="text-[var(--text-4)]">→</span> {d.sell}
							</div>
							<div className="font-mono text-[12.5px] font-semibold text-[var(--success)]">{d.net}</div>
							<div className="font-mono text-[11px] text-[var(--brand)] tracking-[0.04em] uppercase">{d.roi}</div>
						</motion.div>
					))}
				</div>
			</div>
		),
	},
	{
		id: "buy",
		label: "Buy",
		icon: IconBuy,
		prompt: "Buy the top Canon at $40 with auto-accept",
		traces: [
			{ type: "call", text: "offer · v1|206202523567|0 · $40" },
			{ type: "ok", text: "accepted · charged $40.00" },
			{ type: "call", text: "shipping · seller → Planet Express OR" },
			{ type: "ok", text: "queued for intake · 3d ETA" },
		],
		render: () => (
			<div>
				<div className="text-[13.5px] mb-3 leading-[1.55]">
					Offer placed, payment cleared. Headed to Planet Express.
				</div>
				<div className="border border-[var(--border)] rounded-[6px] overflow-hidden text-[13px]">
					<ItemHero sub="v1|206202523567|0 · seller in Tigard, OR" />
					{[
						{ k: "Bid → paid", v: "$42 → $40.00", mono: true },
						{ k: "Cost basis", v: "$40.00 + intake", mono: true, accent: true },
						{ k: "Status", v: "paid · awaiting forwarder intake", mono: false },
					].map((r, i, arr) => (
						<motion.div
							key={r.k}
							initial={{ opacity: 0, y: 3 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.05 + i * 0.05, duration: 0.18 }}
							className={`grid grid-cols-[110px_1fr] items-center px-3.5 py-2.5 ${
								i < arr.length - 1 ? "border-b border-[var(--border-faint)]" : ""
							}`}
						>
							<div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--text-3)]">{r.k}</div>
							<div
								className={`${r.mono ? "font-mono" : ""} ${
									r.accent ? "text-[var(--brand)] font-semibold" : "text-[var(--text)]"
								}`}
							>
								{r.v}
							</div>
						</motion.div>
					))}
				</div>
			</div>
		),
	},
	{
		id: "sell",
		label: "Sell",
		icon: IconSell,
		prompt: "List the Canon at market once it lands at the forwarder",
		traces: [
			{ type: "call", text: "forwarder intake · received OR · photographed" },
			{ type: "ok", text: "ready to list · cost basis $44.00" },
			{ type: "call", text: "ebay_sold_search · canon ef 50mm 1.8 stm · 90d" },
			{ type: "ok", text: "247 sales · median $87 · sample 0.91" },
			{ type: "call", text: "listing_create · $87 · auto title + photos" },
			{ type: "ok", text: "live · 41 watchers in 24h" },
			{ type: "call", text: "sold · buyer NJ · payout queued" },
		],
		render: () => (
			<div>
				<div className="text-[13.5px] mb-3 leading-[1.55]">
					Listed at the median, watched, sold. Reconciled to net margin.
				</div>
				<div className="border border-[var(--border)] rounded-[6px] overflow-hidden text-[13px]">
					<ItemHero sub="listed $87 · 247 comps · sample 0.91" />
					{[
						{ k: "Engagement", v: "41 watchers · 2 questions" },
						{ k: "Sold to", v: "buyer in Newark, NJ" },
						{ k: "Sale price", v: "$87.00", mono: true },
						{ k: "eBay fees", v: "−$11.53 (13.25%)", mono: true, dim: true },
						{ k: "Forwarder", v: "−$4.00 intake/repack", mono: true, dim: true },
						{ k: "Cost basis", v: "−$40.00", mono: true, dim: true },
						{ k: "Net", v: "+$31.47", tag: "79% on cost", mono: true, accent: true },
					].map((r, i, arr) => (
						<motion.div
							key={r.k}
							initial={{ opacity: 0, y: 3 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.05 + i * 0.04, duration: 0.16 }}
							className={`grid grid-cols-[140px_1fr_auto] items-center px-3.5 py-2.5 ${
								i < arr.length - 1 ? "border-b border-[var(--border-faint)]" : ""
							}`}
						>
							<div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--text-3)]">{r.k}</div>
							<div
								className={`${r.mono ? "font-mono" : ""} ${
									r.accent
										? "text-[var(--success)] font-semibold"
										: r.dim
											? "text-[var(--text-3)]"
											: "text-[var(--text)]"
								}`}
							>
								{r.v}
							</div>
							{r.tag ? (
								<div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--brand)]">{r.tag}</div>
							) : (
								<div />
							)}
						</motion.div>
					))}
				</div>
			</div>
		),
	},
	{
		id: "ship",
		label: "Ship",
		icon: IconShip,
		prompt: "Ship the Canon to the buyer in Newark",
		traces: [
			{ type: "call", text: "planet_express · pull from inventory · OR" },
			{ type: "ok", text: "label · USPS Priority · $9.45 (buyer-paid)" },
			{ type: "call", text: "pickup · scanned at PDX hub" },
			{ type: "ok", text: "in transit · cross-country · 2d" },
			{ type: "call", text: "delivered · signed · Newark NJ" },
		],
		render: () => (
			<div>
				<div className="text-[13.5px] mb-3 leading-[1.55]">
					Planet Express handles the box. You see the timeline.
				</div>
				<div className="border border-[var(--border)] rounded-[6px] overflow-hidden text-[13px]">
					<ItemHero sub="USPS 9405 5036 9930 0123 4567 89" />
					{[
						{ stage: "Pulled", at: "Planet Express · OR", time: "04-29 14:02", state: "done" },
						{ stage: "Picked up", at: "PDX hub · USPS Priority $9.45", time: "04-29 17:10", state: "done" },
						{ stage: "In transit", at: "Salt Lake City · sort", time: "04-30 08:45", state: "done" },
						{ stage: "Delivered", at: "Newark, NJ · signed", time: "05-01 10:27", state: "active" },
					].map((r, i, arr) => (
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
								<span className={r.state === "active" ? "font-medium text-[var(--text)]" : "text-[var(--text-2)]"}>{r.stage}</span>
								<span className="font-mono text-[11.5px] text-[var(--text-3)]">{r.at}</span>
							</div>
							<div className="font-mono text-[11px] text-[var(--text-4)] tracking-[0.04em]">{r.time}</div>
						</motion.div>
					))}
				</div>
			</div>
		),
	},
];

function TraceList({ scene, runKey }: { scene: Scene; runKey: number }) {
	const [shown, setShown] = useState(0);
	useEffect(() => {
		setShown(0);
		let i = 0;
		const id = setInterval(() => {
			i++;
			setShown(i);
			if (i >= scene.traces.length) clearInterval(id);
		}, 240);
		return () => clearInterval(id);
	}, [scene.id, runKey]);

	return (
		<div className="font-mono text-[12px] leading-[2] text-[var(--text-2)] mb-3">
			{scene.traces.slice(0, shown).map((t, i) => (
				<motion.div
					key={`${scene.id}-${runKey}-${i}`}
					initial={{ opacity: 0, x: -4 }}
					animate={{ opacity: 1, x: 0 }}
					transition={{ duration: 0.2 }}
				>
					{t.type === "call" ? (
						<>
							<span className="text-[var(--text-4)]">›</span>{" "}
							<span className="text-[var(--text-2)]">{t.text}</span>
						</>
					) : (
						<>
							<span className="text-[var(--success)]">✓</span>{" "}
							<span className="text-[var(--text)]">{t.text}</span>
						</>
					)}
				</motion.div>
			))}
			{shown < scene.traces.length && (
				<div className="flex items-center gap-2">
					<span className="text-[var(--text-4)]">›</span>
					<span className="fc-thinking">working…</span>
				</div>
			)}
		</div>
	);
}

export default function ChatDemo() {
	const [active, setActive] = useState<SceneId>("source");
	const [runKey, setRunKey] = useState(0);
	const [input, setInput] = useState(SCENES[0].prompt);
	const [showResult, setShowResult] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const scene = useMemo(() => SCENES.find((s) => s.id === active)!, [active]);

	useEffect(() => {
		setShowResult(false);
		const t = setTimeout(() => setShowResult(true), scene.traces.length * 240 + 200);
		return () => clearTimeout(t);
	}, [scene.id, runKey, scene.traces.length]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				inputRef.current?.focus();
				inputRef.current?.select();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const submit = (id: SceneId) => {
		setActive(id);
		setRunKey((k) => k + 1);
		setInput(SCENES.find((s) => s.id === id)!.prompt);
	};

	const rerun = () => {
		setRunKey((k) => k + 1);
	};

	return (
		<div className="max-w-[760px] mx-auto mt-12">
			<div className="border border-[var(--border)] rounded-[12px] bg-[var(--surface)] overflow-hidden text-left shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_36px_rgba(0,0,0,0.06)]">
				{/* Tab pills — separate rounded buttons on a soft bar */}
				<div className="flex items-center gap-1 px-2 py-2 border-b border-[var(--border-faint)] bg-[var(--bg-soft)]">
					{SCENES.map((s) => {
						const isActive = s.id === active;
						return (
							<button
								key={s.id}
								onClick={() => submit(s.id)}
								className={`relative flex items-center gap-1.5 h-8 px-3 rounded-[7px] text-[12.5px] font-medium border transition-colors duration-150 cursor-pointer ${
									isActive
										? "bg-[var(--surface)] text-[var(--text)] border-[var(--border-faint)] shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
										: "border-transparent text-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--surface)]"
								}`}
							>
								<span className={isActive ? "text-[var(--brand)]" : ""}>{s.icon}</span>
								{s.label}
							</button>
						);
					})}
				</div>

				{/* Input row: prefix · input · square orange Run button */}
				<div className="flex items-center gap-2 px-2.5 py-2.5 border-b border-[var(--border-faint)]">
					<div className="flex items-center pl-2 pr-1 text-[var(--text-3)] font-mono text-[14px]">›</div>
					<input
						ref={inputRef}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") rerun();
						}}
						placeholder="Ask flipagent…"
						className="flex-1 bg-transparent text-[15px] text-[var(--text)] placeholder:text-[var(--text-4)] outline-none py-2 font-sans"
					/>
					<button
						onClick={rerun}
						aria-label="Run"
						className="flex items-center justify-center w-9 h-9 rounded-[8px] bg-[var(--brand)] text-white shrink-0 transition-transform duration-100 active:scale-95 shadow-[inset_0_-4px_8px_rgba(255,0,0,0.2),0_2px_4px_rgba(255,77,0,0.2)]"
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
							<path d="M5 12h14M13 5l7 7-7 7" />
						</svg>
					</button>
				</div>

				{/* Output */}
				<div className="px-5 py-5 min-h-[320px] max-sm:px-4 max-sm:py-4">
					<AnimatePresence mode="wait">
						<motion.div
							key={`${scene.id}-${runKey}`}
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							transition={{ duration: 0.15 }}
						>
							<TraceList scene={scene} runKey={runKey} />
							{showResult && (
								<motion.div
									initial={{ opacity: 0, y: 4 }}
									animate={{ opacity: 1, y: 0 }}
									transition={{ duration: 0.25 }}
								>
									{scene.render()}
								</motion.div>
							)}
						</motion.div>
					</AnimatePresence>
				</div>
			</div>
		</div>
	);
}
