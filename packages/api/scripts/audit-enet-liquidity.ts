/**
 * Read-only audit: replay every completed evaluate job under a proposed
 * liquidity-aware E[net] and print before/after for every row.
 *
 *   E[net]_new = (1 − P_F) · successNet(saleHat) · D(cycleDays)
 *              − P_F · maxLoss
 *
 * with:
 *   λ        = n / (n + KAPPA)
 *   prior    = min(ask_p25, sample_p25)   — ask-floor anchor; falls back
 *              to sample_median if no asks
 *   saleHat  = λ · sample_median + (1 − λ) · prior
 *   D(t)     = exp(−R · t / 365)
 *
 * Then runs the real `recommendListPrice` against a market clone whose
 * `medianCents` is replaced by `saleHat`, so the cooling-drift / Erlang
 * / queue logic still applies on top.
 *
 * Does NOT touch the DB. Pure stdout dump.
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/audit-enet-liquidity.ts
 *   KAPPA=5 R=0.30 node --env-file=.env --import tsx scripts/audit-enet-liquidity.ts
 */

import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { computeJobs } from "../src/db/schema.js";
import { marketFromSold } from "../src/services/evaluate/adapter.js";
import { evaluate } from "../src/services/evaluate/evaluate.js";
import type { EvaluableItem, EvaluateOptions } from "../src/services/evaluate/types.js";
import { DEFAULT_FEES, recommendListPrice, feeBreakdown } from "../src/services/quant/index.js";

const KAPPA = Number.parseFloat(process.env.KAPPA ?? "5");
const R = Number.parseFloat(process.env.R ?? "0.30");
const OUTBOUND = 1000;

type EvalParams = { itemId?: string; opts?: EvaluateOptions };
type EvalResult = {
	item?: unknown;
	soldPool?: unknown[];
	activePool?: unknown[];
	[key: string]: unknown;
};

function shrunkenMedian(
	n: number,
	sampleMedian: number,
	samplePrior: number,
	askPrior: number | undefined,
): number {
	if (sampleMedian <= 0) return 0;
	const lambda = n / (n + KAPPA);
	const prior = askPrior && askPrior > 0 ? Math.min(askPrior, samplePrior || sampleMedian) : samplePrior || sampleMedian;
	return Math.round(lambda * sampleMedian + (1 - lambda) * prior);
}

function discount(cycleDays: number): number {
	return Math.exp((-R * cycleDays) / 365);
}

interface RowOut {
	title: string;
	n: number;
	asking: number;
	ask_p25: number;
	sample_median: number;
	saleHat: number;
	days: number;
	cycle: number;
	pf: number;
	maxLoss: number;
	old_suc: number;
	new_suc: number;
	d: number;
	old_enet: number;
	new_enet: number;
	delta: number;
	old_rating: string;
	new_rating: string;
	reason: string;
	flip: string;
}

async function main(): Promise<void> {
	const rows = await db
		.select({ id: computeJobs.id, params: computeJobs.params, result: computeJobs.result })
		.from(computeJobs)
		.where(
			and(
				eq(computeJobs.kind, "evaluate"),
				eq(computeJobs.status, "completed"),
				isNotNull(computeJobs.result),
			),
		)
		.orderBy(computeJobs.createdAt);

	const out: RowOut[] = [];
	let totalRows = 0;
	let skippedNoMarket = 0;
	let skippedNoItem = 0;
	let skippedRecFailed = 0;

	for (const row of rows) {
		const result = (row.result ?? {}) as EvalResult;
		const params = (row.params ?? {}) as EvalParams;
		const item = result.item;
		if (!item || typeof item !== "object") {
			skippedNoItem++;
			continue;
		}
		totalRows++;

		const sold = (Array.isArray(result.soldPool) ? result.soldPool : []) as ReadonlyArray<ItemSummary>;
		const active = (Array.isArray(result.activePool) ? result.activePool : []) as ReadonlyArray<ItemSummary>;

		const opts: EvaluateOptions = { ...(params.opts ?? {}), sold, asks: active };
		const oldEval = evaluate(item as EvaluableItem, opts);
		const market = marketFromSold(sold, undefined, undefined, active, item as EvaluableItem);

		if (!oldEval.recommendedExit) {
			skippedNoMarket++;
			continue;
		}

		const n = sold.length;
		const sampleMedian = market.medianCents;
		const samplePrior = market.p25Cents;
		const askP25 = market.asks?.p25Cents;
		const saleHat = shrunkenMedian(n, sampleMedian, samplePrior, askP25);

		const candidateId = (item as { itemId?: string }).itemId;
		const askPrices = active
			.filter((a) => a.itemId !== candidateId)
			.map((a) => Number.parseFloat(a.price?.value ?? "0") * 100)
			.filter((p) => p > 0);
		const itemPriceCents = Math.round(
			Number.parseFloat((item as { price?: { value?: string } }).price?.value ?? "0") * 100,
		);
		const itemShipCents = Math.round(
			Number.parseFloat(
				(item as { shippingOptions?: { shippingCost?: { value?: string } }[] }).shippingOptions?.[0]
					?.shippingCost?.value ?? "0",
			) * 100,
		);
		const buyPriceCents = itemPriceCents + itemShipCents;
		const outboundShipping =
			oldEval.landedCostCents != null
				? oldEval.landedCostCents
				: opts.outboundShippingCents ?? OUTBOUND;

		const newRec = recommendListPrice(
			{ ...market, medianCents: saleHat },
			{
				fees: DEFAULT_FEES,
				outboundShippingCents: outboundShipping,
				activeAskPrices: askPrices,
				buyPriceCents,
			},
		);
		if (!newRec) {
			skippedRecFailed++;
			continue;
		}
		const newSuc = newRec.netCents;

		const cycleDays = oldEval.risk?.cycleDays ?? 27;
		const pf = oldEval.risk?.P_fraud ?? 0;
		const maxLoss = oldEval.maxLossCents ?? 0;
		const D = discount(cycleDays);
		// NPV form: discount the inflow only — buy is paid today, in
		// today's dollars. Putting D on net would make a slow LOSS look
		// less bad than a fast loss (wrong direction).
		const newFees = feeBreakdown(newRec.listPriceCents, DEFAULT_FEES).totalCents;
		const grossInflow = newRec.listPriceCents - newFees - outboundShipping;
		const pv = grossInflow * D - buyPriceCents;
		const newEnet = Math.round((1 - pf) * pv - pf * maxLoss);

		const oldRating = oldEval.rating;
		const minNet = opts.minNetCents ?? 0;
		// New rating uses the same gates as today: still skip on insufficient_data /
		// no_market / vetoed; otherwise compare new E[net] to minNet.
		let newRating: "buy" | "skip";
		const reasonCode = oldEval.reasonCode;
		if (reasonCode === "vetoed" || reasonCode === "no_market" || reasonCode === "insufficient_data") {
			newRating = "skip";
		} else {
			newRating = newEnet >= minNet ? "buy" : "skip";
		}

		const flip =
			oldRating === newRating
				? "—"
				: `${oldRating}→${newRating}`;

		out.push({
			title: ((item as { title?: string }).title ?? "?").slice(0, 44),
			n,
			asking: Math.round(buyPriceCents),
			ask_p25: askP25 ?? 0,
			sample_median: sampleMedian,
			saleHat,
			days: Math.round(oldEval.recommendedExit.expectedDaysToSell),
			cycle: cycleDays,
			pf,
			maxLoss,
			old_suc: oldEval.successNetCents ?? 0,
			new_suc: newSuc,
			d: D,
			old_enet: oldEval.expectedNetCents,
			new_enet: newEnet,
			delta: newEnet - oldEval.expectedNetCents,
			old_rating: oldRating,
			new_rating: newRating,
			reason: oldEval.reasonCode ?? "",
			flip,
		});
	}

	const fmt = (c: number): string => (c / 100).toFixed(2);
	const fmt0 = (c: number): string => (c / 100).toFixed(0);

	out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

	console.log("");
	console.log(`κ=${KAPPA}  R=${R}/yr  outbound=$${OUTBOUND / 100}`);
	console.log(`scored=${out.length}  skipNoItem=${skippedNoItem}  skipNoMarket=${skippedNoMarket}  skipRec=${skippedRecFailed}  totalRowsConsidered=${totalRows}`);
	console.log("");
	console.log("(sorted by |Δ E[net]| descending — biggest model impact first)");
	console.log("");

	const header = [
		"n".padStart(3),
		"ask".padStart(7),
		"med".padStart(7),
		"saleHat".padStart(7),
		"days".padStart(5),
		"cyc".padStart(4),
		"P_F".padStart(5),
		"maxL".padStart(6),
		"old_suc".padStart(7),
		"new_suc".padStart(7),
		"D".padStart(5),
		"old_E".padStart(7),
		"new_E".padStart(7),
		"Δ".padStart(7),
		"flip".padEnd(11),
		"reason".padEnd(18),
		"title",
	].join("  ");
	console.log(header);
	console.log("-".repeat(header.length + 60));

	for (const r of out) {
		console.log(
			[
				`${r.n}`.padStart(3),
				fmt0(r.asking).padStart(7),
				fmt0(r.sample_median).padStart(7),
				fmt0(r.saleHat).padStart(7),
				`${r.days}`.padStart(5),
				`${r.cycle}`.padStart(4),
				r.pf.toFixed(3).padStart(5),
				fmt0(r.maxLoss).padStart(6),
				fmt0(r.old_suc).padStart(7),
				fmt0(r.new_suc).padStart(7),
				r.d.toFixed(2).padStart(5),
				fmt(r.old_enet).padStart(7),
				fmt(r.new_enet).padStart(7),
				fmt(r.delta).padStart(7),
				r.flip.padEnd(11),
				r.reason.padEnd(18),
				r.title,
			].join("  "),
		);
	}

	const flips = out.filter((r) => r.flip !== "—");
	const buyToSkip = flips.filter((r) => r.flip === "buy→skip");
	const skipToBuy = flips.filter((r) => r.flip === "skip→buy");

	console.log("");
	console.log(`flips: total=${flips.length}  buy→skip=${buyToSkip.length}  skip→buy=${skipToBuy.length}`);
	console.log("");

	if (skipToBuy.length > 0) {
		console.log("⚠️  skip→buy flips (regression candidates — were skip today, model now says buy):");
		for (const r of skipToBuy) {
			console.log(
				`   n=${r.n} ask=$${fmt0(r.asking)} sale=$${fmt0(r.saleHat)} days=${r.days} new_E=$${fmt(r.new_enet)} reason_was=${r.reason}  ${r.title}`,
			);
		}
		console.log("");
	}

	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});
