/**
 * Deep-dive any evaluation: dump candidate, sold pool, active pool, all
 * with seller info. Re-run evaluation under current quant model. Print
 * everything a reseller would want to see before deciding "buy or skip".
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/case-deep-dive.ts <job-id>
 */

import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { computeJobs } from "../src/db/schema.js";
import { evaluate } from "../src/services/evaluate/evaluate.js";
import type { EvaluableItem, EvaluateOptions } from "../src/services/evaluate/types.js";
import { sellerTrust } from "../src/services/quant/risk.js";

const id = process.argv[2];
if (!id) {
	console.error("usage: case-deep-dive.ts <job-id>");
	process.exit(1);
}

type ItemSeller = { username?: string; feedbackScore?: number; feedbackPercentage?: string };
function trustOf(seller: ItemSeller | undefined): number {
	return sellerTrust(
		seller?.feedbackScore,
		seller?.feedbackPercentage ? Number.parseFloat(seller.feedbackPercentage) : undefined,
	);
}

const $ = (c: number | null | undefined) => (c == null ? "—" : `$${(c / 100).toFixed(0)}`);
const dol = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(0)}`);

async function main() {
	const [row] = await db.select().from(computeJobs).where(eq(computeJobs.id, id));
	if (!row) throw new Error("not found");
	const params = (row.params ?? {}) as { opts?: EvaluateOptions };
	const result = (row.result ?? {}) as {
		item: EvaluableItem;
		soldPool?: ItemSummary[];
		activePool?: ItemSummary[];
		market?: { medianCents?: number; meanCents?: number; stdDevCents?: number; nObservations?: number; salesPerDay?: number; meanDaysToSell?: number; asks?: { medianCents?: number; nActive?: number } };
	};

	const item = result.item as EvaluableItem & { seller?: ItemSeller; price?: { value?: string }; title?: string; itemWebUrl?: string; condition?: string; returnTerms?: { returnsAccepted?: boolean; returnPeriod?: { value?: number; unit?: string }; returnShippingCostPayer?: string } };
	const sold = (result.soldPool ?? []) as ItemSummary[];
	const active = (result.activePool ?? []) as ItemSummary[];

	console.log("════════════════════════════════════════════════════════════════════════");
	console.log(`CANDIDATE`);
	console.log("════════════════════════════════════════════════════════════════════════");
	console.log(`title:      ${item.title}`);
	console.log(`url:        ${item.itemWebUrl}`);
	console.log(`price:      $${item.price?.value}`);
	console.log(`condition:  ${item.condition ?? "—"}`);
	console.log(`returns:    ${item.returnTerms?.returnsAccepted ? `${item.returnTerms.returnPeriod?.value}${item.returnTerms.returnPeriod?.unit} (${item.returnTerms.returnShippingCostPayer})` : "no returns"}`);
	console.log(`seller:     ${item.seller?.username} (fb=${item.seller?.feedbackScore ?? 0}, ${item.seller?.feedbackPercentage ?? "?"}%)  trust=${trustOf(item.seller).toFixed(3)}`);

	const m = result.market;
	console.log("");
	console.log("════════════════════════════════════════════════════════════════════════");
	console.log(`MARKET (full pool stats from DB)`);
	console.log("════════════════════════════════════════════════════════════════════════");
	console.log(`sold n:           ${m?.nObservations}`);
	console.log(`sold mean:        ${$(m?.meanCents)}`);
	console.log(`sold median:      ${$(m?.medianCents)}`);
	console.log(`sold stdDev:      ${$(m?.stdDevCents)}  (CV ${m?.medianCents ? ((m.stdDevCents ?? 0) / m.medianCents).toFixed(2) : "—"})`);
	console.log(`sales/day:        ${m?.salesPerDay?.toFixed(2)}`);
	console.log(`mean days→sell:   ${m?.meanDaysToSell?.toFixed(1) ?? "—"}`);
	console.log(`active n:         ${m?.asks?.nActive ?? active.length}`);
	console.log(`active median:    ${$(m?.asks?.medianCents)}`);

	console.log("");
	console.log("════════════════════════════════════════════════════════════════════════");
	console.log(`SOLD POOL (n=${sold.length}) — sorted by price`);
	console.log("════════════════════════════════════════════════════════════════════════");
	console.log(`price       seller          fb       %     trust   condition`);
	console.log(`────────────────────────────────────────────────────────────────────────`);
	const soldRows = [...sold].sort(
		(a, b) => Number.parseFloat(a.price?.value ?? "0") - Number.parseFloat(b.price?.value ?? "0"),
	);
	for (const it of soldRows) {
		const s = (it as { seller?: ItemSeller }).seller;
		const t = trustOf(s);
		console.log(
			`$${(it.price?.value ?? "0").padStart(8)}  ${(s?.username ?? "—").padEnd(15)}  ${String(s?.feedbackScore ?? 0).padStart(6)}  ${(s?.feedbackPercentage ?? "—").padStart(5)}  ${t.toFixed(3)}   ${it.condition ?? "—"}`,
		);
	}

	console.log("");
	console.log("════════════════════════════════════════════════════════════════════════");
	console.log(`ACTIVE POOL (n=${active.length}) — sorted by price`);
	console.log("════════════════════════════════════════════════════════════════════════");
	console.log(`price       seller          fb       %     trust   condition`);
	console.log(`────────────────────────────────────────────────────────────────────────`);
	const activeRows = [...active].sort(
		(a, b) => Number.parseFloat(a.price?.value ?? "0") - Number.parseFloat(b.price?.value ?? "0"),
	);
	for (const it of activeRows) {
		const s = (it as { seller?: ItemSeller }).seller;
		const t = trustOf(s);
		console.log(
			`$${(it.price?.value ?? "0").padStart(8)}  ${(s?.username ?? "—").padEnd(15)}  ${String(s?.feedbackScore ?? 0).padStart(6)}  ${(s?.feedbackPercentage ?? "—").padStart(5)}  ${t.toFixed(3)}   ${it.condition ?? "—"}`,
		);
	}

	console.log("");
	console.log("════════════════════════════════════════════════════════════════════════");
	console.log(`EVALUATION (rerun under current model)`);
	console.log("════════════════════════════════════════════════════════════════════════");
	const opts: EvaluateOptions = { ...(params.opts ?? {}), sold, asks: active };
	const e = evaluate(item, opts);
	console.log(`rating:           ${e.rating}`);
	console.log(`reason:           ${e.reason}`);
	console.log(`P_fraud:          ${((e.risk?.P_fraud ?? 0) * 100).toFixed(1)}%`);
	console.log(`maxLoss:          ${$(e.maxLossCents)}`);
	console.log(`successNet:       ${$(e.successNetCents)}`);
	console.log(`expectedNet:      ${$(e.expectedNetCents)}`);
	console.log(`bidCeiling:       ${$(e.bidCeilingCents)}`);
	console.log(`netRange p10/p90: ${$(e.netRangeCents?.p10Cents)} / ${$(e.netRangeCents?.p90Cents)}`);
	if (e.recommendedExit) {
		console.log("");
		console.log(`recommendedExit:`);
		console.log(`  list at:        ${$(e.recommendedExit.listPriceCents)}`);
		console.log(`  expected days:  ${e.recommendedExit.expectedDaysToSell.toFixed(1)} (band ${e.recommendedExit.daysLow.toFixed(1)}–${e.recommendedExit.daysHigh.toFixed(1)})`);
		console.log(`  net at exit:    ${$(e.recommendedExit.netCents)}`);
		console.log(`  $/day:          ${$(e.recommendedExit.dollarsPerDay)}`);
		console.log(`  queue ahead:    ${e.recommendedExit.queueAhead} (asks above: ${e.recommendedExit.asksAbove})`);
	}
	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(2);
});
