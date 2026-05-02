/**
 * One-shot β-fit script. Run via `npm run fit-beta` on the hosted
 * instance — typically as a nightly cron. Prints per-category results
 * so the operator can sanity-check the fit quality before fits start
 * influencing recommendations.
 *
 * Idempotent: each run upserts category_calibration rows. Self-host
 * deployments have OBSERVATION_ENABLED off → no observations → script
 * is a no-op (prints "no observations to fit").
 */

import { fitCategoryBeta } from "../services/calibration.js";

async function main() {
	console.log("[fit-beta] starting category β fit...");
	const results = await fitCategoryBeta();
	if (results.length === 0) {
		console.log("[fit-beta] no categories met the minimum-observations floor (30). Nothing to fit.");
		process.exit(0);
	}
	console.log(`[fit-beta] fit ${results.length} categories:`);
	for (const r of results.sort((a, b) => b.n - a.n)) {
		console.log(
			`  ${r.categoryId.padEnd(8)}  β=${r.beta.toFixed(2).padStart(5)}  n=${String(r.n).padStart(5)}  R²=${r.r2.toFixed(2)}`,
		);
	}
	process.exit(0);
}

main().catch((err) => {
	console.error("[fit-beta] failed:", err);
	process.exit(1);
});
