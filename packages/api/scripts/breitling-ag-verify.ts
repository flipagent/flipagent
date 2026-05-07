/**
 * End-to-end verification of the AG fix on the actual Breitling case
 * (job `0442afc8-3364-4025-a899-e3ec5c9c0716`):
 *
 *   1. Load the saved comp pool (from the production evaluate run that
 *      produced `suspiciousIds["v1|377153137412|0"].pFraud = 0.5689`).
 *   2. Simulate the new scraper output by tagging every active comp
 *      that lacks `seller` with `qualifiedPrograms: ["AUTHENTICITY_GUARANTEE"]`
 *      (= what the updated `parseEbaySearchHtml` now emits for AG cards).
 *   3. Re-run `partitionSuspicious` against the patched pool.
 *   4. Print BEFORE / AFTER counts so the fix is verifiable on real data.
 */

import type { ItemSummary } from "@flipagent/types/ebay/buy";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { computeJobs } from "../src/db/schema.js";
import { partitionSuspicious } from "../src/services/evaluate/suspicious.js";

const JOB_ID = "0442afc8-3364-4025-a899-e3ec5c9c0716";

type StoredEval = {
	soldPool?: ItemSummary[];
	activePool?: ItemSummary[];
	suspiciousIds?: Record<string, { reason: string; pFraud: number }>;
};

function pct(p: number): string {
	return `${(p * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
	const [row] = await db.select().from(computeJobs).where(eq(computeJobs.id, JOB_ID));
	if (!row) throw new Error(`job ${JOB_ID} not found`);
	const result = (row.result ?? {}) as StoredEval;
	const sold = (result.soldPool ?? []) as ItemSummary[];
	const active = (result.activePool ?? []) as ItemSummary[];
	const beforeSus = result.suspiciousIds ?? {};

	console.log(`Job: ${JOB_ID}`);
	console.log(`Sold pool:   ${sold.length} items`);
	console.log(`Active pool: ${active.length} items`);
	console.log("");
	console.log("BEFORE (stored in DB — ran with old scraper):");
	for (const [id, sus] of Object.entries(beforeSus)) {
		console.log(`  ${id}: ${pct(sus.pFraud)}  ${sus.reason}`);
	}
	console.log(`  total flagged: ${Object.keys(beforeSus).length}`);
	console.log("");

	// Simulate the new scraper output: every active comp without a seller
	// block on a luxury-watch SRP would now carry the AG enrichment.
	const patchedActive: ItemSummary[] = active.map((it) => {
		if (it.seller) return it;
		return {
			...it,
			authenticityGuarantee: { description: "Authenticity Guarantee" },
			qualifiedPrograms: ["AUTHENTICITY_GUARANTEE"],
		};
	});
	const patchCount = patchedActive.filter((it, i) => active[i] !== it).length;
	console.log(`Patched ${patchCount}/${active.length} active comps with AG enrichment.`);
	console.log("");

	// Re-run with current code on the patched pool.
	const { suspiciousIds: afterSus, cleanSold, cleanActive } = partitionSuspicious(sold, patchedActive);

	console.log("AFTER (current code + AG-enriched comps):");
	if (Object.keys(afterSus).length === 0) {
		console.log("  (no comps flagged — fix works)");
	} else {
		for (const [id, sus] of Object.entries(afterSus)) {
			console.log(`  ${id}: ${pct(sus.pFraud)}  ${sus.reason}`);
		}
	}
	console.log(`  total flagged: ${Object.keys(afterSus).length}`);
	console.log(`  cleanSold:   ${cleanSold.length}`);
	console.log(`  cleanActive: ${cleanActive.length}`);
	console.log("");

	// Sanity check on the candidate's own listing — it appeared in the
	// active pool with the 57% false positive. Print its computed P_fraud
	// on the patched run to confirm.
	const candidateCopy = patchedActive.find((it) => it.itemId === "v1|377153137412|0");
	if (candidateCopy) {
		console.log("Candidate's active-pool copy after patch:");
		console.log("  authenticityGuarantee:", candidateCopy.authenticityGuarantee);
		console.log("  qualifiedPrograms:    ", candidateCopy.qualifiedPrograms);
		const stillFlagged = afterSus[candidateCopy.itemId];
		console.log(`  flagged in afterSus:  ${stillFlagged ? `YES (${pct(stillFlagged.pFraud)})` : "NO"}`);
	}

	process.exit(0);
}

await main();
