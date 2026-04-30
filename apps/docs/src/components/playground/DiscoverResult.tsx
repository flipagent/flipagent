/**
 * Discover result — table of variant clusters with a side-drawer detail.
 *
 *   1. One-line summary (count · sort key)
 *   2. Table — one row per variant cluster (server already partitioned
 *      candidates by canonical × condition × variant via LLM, so each
 *      row IS a unique product offering).
 *   3. Click a row → drawer slides in from the viewport's right edge
 *      with the cluster's full Evaluate report (`<EvaluateResultBody>`
 *      fed the cluster directly — byte-identical to an Evaluate result).
 *   4. Trace footer (same Footer as Evaluate — Copy JSON + Hide trace toggle).
 *
 * No client-side grouping. The server's `cluster.identified` /
 * `cluster.ready` events deliver one cluster per row; we just render.
 */

import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { EvaluateResultBody, Footer, Skel } from "./EvaluateResult";
import { Trace } from "./Trace";
import type { DiscoverOutcome, EvaluateOutcome } from "./pipelines";
import type { DealCluster, ItemSummary, Step } from "./types";

/* ------------------------------ root ------------------------------ */

export function DiscoverResult({
	outcome,
	steps,
	pending,
	hasRun,
	sellWithinDays,
	selectedClusterIdx,
	onSelectCluster,
}: {
	outcome: Partial<DiscoverOutcome>;
	steps: Step[];
	pending: boolean;
	hasRun: boolean;
	sellWithinDays?: number;
	/** Selected cluster index in `outcome.clusters` — drives the drawer. */
	selectedClusterIdx: number | null;
	onSelectCluster: (idx: number | null) => void;
}) {
	const clusters = outcome.clusters ?? [];
	const totalListings = clusters.reduce((s, c) => s + c.count, 0);

	const stalled =
		!pending && hasRun && clusters.length === 0 && steps.some((s) => s.status === "error");
	const showInitialScaffold = pending && clusters.length === 0;
	const noResults = !pending && hasRun && clusters.length === 0;

	const selectedCluster = selectedClusterIdx != null ? clusters[selectedClusterIdx] ?? null : null;

	return (
		<motion.div
			className="pg-result"
			data-stalled={stalled ? "true" : undefined}
			initial={{ opacity: 0, y: 4 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.25 }}
		>
			{(clusters.length > 0 || showInitialScaffold) && (
				<DiscoverHeader totalListings={totalListings} clusterCount={clusters.length} pending={pending} />
			)}

			{noResults && (
				<p className="pg-discover-empty">
					No deals matched. Try a wider category, looser price cap, or a different keyword.
				</p>
			)}

			<DiscoverTable
				clusters={clusters}
				showInitialScaffold={showInitialScaffold}
				selectedIdx={selectedClusterIdx}
				onSelectCluster={(idx) => onSelectCluster(idx === selectedClusterIdx ? null : idx)}
			/>

			{/* Footer matches Evaluate's two-state shape: bare Trace inside
			    `pg-result-foot--running` while pending, full Footer (Copy
			    JSON + Hide-trace toggle + Trace) once the run completes
			    so the trace section reads identically across both pillars. */}
			{pending ? (
				<div className="pg-result-foot pg-result-foot--running">
					<Trace steps={steps} />
				</div>
			) : (
				<Footer payload={{ clusters }} steps={steps} />
			)}

			<AnimatePresence>
				{selectedCluster && (
					<DiscoverDetailDrawer
						cluster={selectedCluster}
						sellWithinDays={sellWithinDays}
						onClose={() => onSelectCluster(null)}
					/>
				)}
			</AnimatePresence>
		</motion.div>
	);
}

/* ------------------------- summary header ------------------------- */

function DiscoverHeader({
	totalListings,
	clusterCount,
	pending,
}: {
	totalListings: number;
	clusterCount: number;
	pending: boolean;
}) {
	const parts: string[] = [];
	if (clusterCount > 0) {
		parts.push(`${clusterCount} product${clusterCount === 1 ? "" : "s"}`);
		if (totalListings > clusterCount) parts.push(`${totalListings} active listings`);
		parts.push("sorted by $/day");
	} else {
		parts.push("Searching…");
	}
	return (
		<p className="pg-discover-summary">
			{parts.join(" · ")}
			{pending && clusterCount > 0 && (
				<span className="pg-discover-summary-loading"> · still loading…</span>
			)}
		</p>
	);
}

/* ------------------------------ table ------------------------------ */

function DiscoverTable({
	clusters,
	showInitialScaffold,
	selectedIdx,
	onSelectCluster,
}: {
	clusters: ReadonlyArray<DealCluster>;
	showInitialScaffold: boolean;
	selectedIdx: number | null;
	onSelectCluster: (idx: number) => void;
}) {
	const skeletonRows = showInitialScaffold ? 5 : 0;
	// Column labels match Evaluate's facts-grid vocabulary 1:1
	// ("Buy at" / "Resells at" / "Est. profit" / "$/day"). Each row IS
	// a per-variant Evaluate result preview. Sign-color on Est. profit
	// carries the verdict — no rating chip needed.
	return (
		<div className="pg-discover-table-wrap">
			<table className="pg-discover-table">
				<thead>
					<tr>
						<th className="pg-discover-th pg-discover-th--img" aria-label="Image" />
						<th className="pg-discover-th pg-discover-th--title">Listing</th>
						<th className="pg-discover-th pg-discover-th--num">Buy at</th>
						<th className="pg-discover-th pg-discover-th--num">Resells at</th>
						<th className="pg-discover-th pg-discover-th--num">Est. profit</th>
						<th className="pg-discover-th pg-discover-th--num">Sells in</th>
						<th className="pg-discover-th pg-discover-th--num">$/day</th>
					</tr>
				</thead>
				<tbody>
					{clusters.map((c, idx) => (
						<DiscoverRow
							key={c.canonical + idx}
							cluster={c}
							selected={idx === selectedIdx}
							onSelect={() => onSelectCluster(idx)}
						/>
					))}
					{Array.from({ length: skeletonRows }).map((_, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: skeleton rows are stable
						<DiscoverSkeletonRow key={`skel-${i}`} />
					))}
				</tbody>
			</table>
		</div>
	);
}

/** True when this cluster is a `cluster.identified` placeholder, not yet
 *  filled in by `cluster.ready`. Detected via empty soldPool + empty
 *  evaluation. */
function isPlaceholder(c: DealCluster): boolean {
	return c.soldPool.length === 0 && c.activePool.length === 0;
}

function DiscoverRow({
	cluster,
	selected,
	onSelect,
}: {
	cluster: DealCluster;
	selected: boolean;
	onSelect: () => void;
}) {
	const exit = cluster.evaluation.recommendedExit;
	const item = cluster.item;
	const buyCents = priceCents(item);
	const placeholder = isPlaceholder(cluster);

	if (placeholder) {
		// Loading row — show canonical name + skeleton numbers so the user
		// sees "this product is being scored" with the right structure.
		return (
			<tr className="pg-discover-tr pg-discover-tr--skel" aria-hidden="true">
				<td className="pg-discover-td pg-discover-td--img">
					<div className="pg-discover-thumb pg-result-skel" />
				</td>
				<td className="pg-discover-td pg-discover-td--title">
					<span className="pg-discover-title-text">{cluster.canonical}</span>
					{cluster.count > 1 && (
						<span className="pg-discover-title-meta">{cluster.count} active · scoring…</span>
					)}
				</td>
				<td className="pg-discover-td pg-discover-td--num">
					<Skel w={42} />
				</td>
				<td className="pg-discover-td pg-discover-td--num">
					<Skel w={42} />
				</td>
				<td className="pg-discover-td pg-discover-td--num">
					<Skel w={42} />
				</td>
				<td className="pg-discover-td pg-discover-td--num">
					<Skel w={36} />
				</td>
				<td className="pg-discover-td pg-discover-td--num">
					<Skel w={32} />
				</td>
			</tr>
		);
	}

	return (
		<tr
			className="pg-discover-tr"
			data-selected={selected ? "true" : undefined}
			onClick={onSelect}
			tabIndex={0}
			onKeyDown={(ev) => {
				if (ev.key === "Enter" || ev.key === " ") {
					ev.preventDefault();
					onSelect();
				}
			}}
		>
			<td className="pg-discover-td pg-discover-td--img">
				<div className="pg-discover-thumb">
					{item.image?.imageUrl ? (
						<img src={item.image.imageUrl} alt="" loading="lazy" />
					) : (
						<span aria-hidden="true">·</span>
					)}
				</div>
			</td>
			<td className="pg-discover-td pg-discover-td--title">
				<span className="pg-discover-title-text" title={item.title}>
					{item.title}
				</span>
				{(cluster.count > 1 || item.condition) && (
					<span className="pg-discover-title-meta">
						{item.condition ? <span>{item.condition}</span> : null}
						{cluster.count > 1 ? <span>{cluster.count} active</span> : null}
					</span>
				)}
			</td>
			<td className="pg-discover-td pg-discover-td--num font-mono">
				{buyCents != null ? `$${Math.round(buyCents / 100)}` : "—"}
			</td>
			<td className="pg-discover-td pg-discover-td--num font-mono">
				{exit ? `$${Math.round(exit.listPriceCents / 100)}` : "—"}
			</td>
			<td
				className={`pg-discover-td pg-discover-td--num font-mono ${
					exit && exit.netCents >= 0 ? "pg-discover-good" : exit ? "pg-discover-warn" : ""
				}`}
			>
				{exit ? `${exit.netCents >= 0 ? "+" : "−"}$${Math.abs(Math.round(exit.netCents / 100))}` : "—"}
			</td>
			<td className="pg-discover-td pg-discover-td--num font-mono">
				{exit ? `~${Math.max(1, Math.round(exit.expectedDaysToSell))}d` : "—"}
			</td>
			<td className="pg-discover-td pg-discover-td--num font-mono">
				{exit ? `$${Math.round(exit.dollarsPerDay / 100)}` : "—"}
			</td>
		</tr>
	);
}

function DiscoverSkeletonRow() {
	return (
		<tr className="pg-discover-tr pg-discover-tr--skel" aria-hidden="true">
			<td className="pg-discover-td pg-discover-td--img">
				<div className="pg-discover-thumb pg-result-skel" />
			</td>
			<td className="pg-discover-td pg-discover-td--title">
				<Skel w={240} />
			</td>
			<td className="pg-discover-td pg-discover-td--num">
				<Skel w={42} />
			</td>
			<td className="pg-discover-td pg-discover-td--num">
				<Skel w={42} />
			</td>
			<td className="pg-discover-td pg-discover-td--num">
				<Skel w={42} />
			</td>
			<td className="pg-discover-td pg-discover-td--num">
				<Skel w={36} />
			</td>
			<td className="pg-discover-td pg-discover-td--num">
				<Skel w={32} />
			</td>
		</tr>
	);
}

/* ----------------------- detail drawer ----------------------- */

/**
 * Right-edge drawer with the cluster's full Evaluate report. The
 * cluster IS already an EvaluateResponse-shape payload, so we feed it
 * to `EvaluateResultBody` directly — no synthesis needed. Closes via
 * X / backdrop click / ESC.
 */
function DiscoverDetailDrawer({
	cluster,
	sellWithinDays,
	onClose,
}: {
	cluster: DealCluster;
	sellWithinDays?: number;
	onClose: () => void;
}) {
	useEffect(() => {
		const onKey = (ev: KeyboardEvent) => {
			if (ev.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	const outcome: Partial<EvaluateOutcome> = {
		item: cluster.item,
		evaluation: cluster.evaluation,
		market: cluster.market,
		soldPool: cluster.soldPool,
		activePool: cluster.activePool,
		rejectedSoldPool: cluster.rejectedSoldPool,
		rejectedActivePool: cluster.rejectedActivePool,
		returns: cluster.returns,
		meta: cluster.meta,
	};

	return (
		<>
			<motion.div
				className="pg-discover-drawer-backdrop"
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				exit={{ opacity: 0 }}
				transition={{ duration: 0.18 }}
				onClick={onClose}
				aria-hidden="true"
			/>
			<motion.aside
				className="pg-discover-drawer"
				role="dialog"
				aria-modal="true"
				aria-label="Deal detail"
				initial={{ x: "100%" }}
				animate={{ x: 0 }}
				exit={{ x: "100%" }}
				transition={{ type: "tween", duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
			>
				<button
					type="button"
					onClick={onClose}
					className="pg-discover-drawer-close"
					aria-label="Close detail"
					title="Close (Esc)"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.6"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M3 3l10 10M13 3l-10 10" />
					</svg>
				</button>
				<div className="pg-discover-drawer-body">
					<EvaluateResultBody outcome={outcome} sellWithinDays={sellWithinDays} pending={false} />
				</div>
			</motion.aside>
		</>
	);
}

/* ------------------------------ helpers ------------------------------ */

function priceCents(item: ItemSummary): number | null {
	if (!item.price) return null;
	const n = Math.round(Number.parseFloat(item.price.value) * 100);
	return Number.isFinite(n) ? n : null;
}
