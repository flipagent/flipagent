/**
 * Per-category elasticity (β) fitter. Reads `listing_observations`
 * grouped by categoryId, regresses observed list-to-sell duration vs
 * price-z within the category, and writes the fitted β to
 * `category_calibration`.
 *
 * Math:
 *   For each observation: z = (priceCents − categoryMean) / categoryStdDev,
 *                          T = days(itemEndDate − itemCreationDate)
 *   Hazard model: T(z) = T̄ · exp(β · z)  →  ln T = ln T̄ + β·z
 *   Linear regression on (z, ln T) yields β.
 *
 * Floor n_observations at 30 per category — under that the fit is
 * noisy, fallback to default β=1.5 stays in effect.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { categoryCalibration, listingObservations } from "../../db/schema.js";

const MIN_OBSERVATIONS_PER_CATEGORY = 30;

interface CategoryFitResult {
	categoryId: string;
	beta: number;
	n: number;
	r2: number;
}

/**
 * Run the fit job. Returns the per-category results so callers (CLI
 * script, future cron) can log progress. Idempotent — upsert on
 * categoryId — and safe to call concurrently (the upsert handles races).
 */
export async function fitCategoryBeta(): Promise<CategoryFitResult[]> {
	// Pull every observation that has both endpoints of the duration
	// and a usable price. Group in JS (DB-side regression is overkill
	// for the volumes we're at; revisit when this gets slow).
	const rows = await db
		.select({
			categoryId: listingObservations.categoryId,
			priceCents: sql<number>`coalesce(${listingObservations.lastSoldPriceCents}, ${listingObservations.priceCents})`,
			itemCreationDate: listingObservations.itemCreationDate,
			itemEndDate: listingObservations.itemEndDate,
			lastSoldDate: listingObservations.lastSoldDate,
		})
		.from(listingObservations)
		.where(sql`${listingObservations.takedownAt} IS NULL`);

	const byCategory = new Map<string, { z: number; lnT: number }[]>();
	const meanByCategory = new Map<string, { mean: number; stdDev: number }>();

	// First pass: compute per-category mean + stdDev of price.
	const pricesByCategory = new Map<string, number[]>();
	for (const row of rows) {
		if (!row.categoryId || !row.priceCents || row.priceCents <= 0) continue;
		const list = pricesByCategory.get(row.categoryId) ?? [];
		list.push(row.priceCents);
		pricesByCategory.set(row.categoryId, list);
	}
	for (const [cat, prices] of pricesByCategory) {
		if (prices.length < MIN_OBSERVATIONS_PER_CATEGORY) continue;
		const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
		const variance = prices.reduce((a, b) => a + (b - mean) ** 2, 0) / prices.length;
		const stdDev = Math.sqrt(variance);
		if (stdDev <= 0) continue;
		meanByCategory.set(cat, { mean, stdDev });
	}

	// Second pass: build (z, ln T) pairs per category.
	for (const row of rows) {
		if (!row.categoryId) continue;
		const stats = meanByCategory.get(row.categoryId);
		if (!stats) continue;
		if (!row.priceCents || row.priceCents <= 0) continue;
		const start = row.itemCreationDate ? new Date(row.itemCreationDate).getTime() : null;
		const end = row.itemEndDate
			? new Date(row.itemEndDate).getTime()
			: row.lastSoldDate
				? new Date(row.lastSoldDate).getTime()
				: null;
		if (start == null || end == null || end <= start) continue;
		const days = (end - start) / 86_400_000;
		if (days <= 0) continue;
		const z = (row.priceCents - stats.mean) / stats.stdDev;
		const list = byCategory.get(row.categoryId) ?? [];
		list.push({ z, lnT: Math.log(days) });
		byCategory.set(row.categoryId, list);
	}

	const results: CategoryFitResult[] = [];

	for (const [categoryId, points] of byCategory) {
		if (points.length < MIN_OBSERVATIONS_PER_CATEGORY) continue;
		// Simple least-squares: β = Cov(z, lnT) / Var(z).
		const n = points.length;
		const meanZ = points.reduce((a, p) => a + p.z, 0) / n;
		const meanLnT = points.reduce((a, p) => a + p.lnT, 0) / n;
		let cov = 0;
		let varZ = 0;
		let totSS = 0;
		for (const p of points) {
			const dz = p.z - meanZ;
			const dt = p.lnT - meanLnT;
			cov += dz * dt;
			varZ += dz * dz;
			totSS += dt * dt;
		}
		if (varZ <= 0) continue;
		const beta = cov / varZ;
		// R² — fraction of duration variance explained by price-z.
		const intercept = meanLnT - beta * meanZ;
		let resSS = 0;
		for (const p of points) {
			const predicted = intercept + beta * p.z;
			resSS += (p.lnT - predicted) ** 2;
		}
		const r2 = totSS > 0 ? Math.max(0, 1 - resSS / totSS) : 0;

		// Sanity-clamp β to [0, 8] — the hazard model defaults sit at 1.5,
		// real markets cluster around 1–5; values outside that range are
		// almost certainly fit artefacts on a noisy category.
		const clampedBeta = Math.max(0, Math.min(8, beta));

		await db
			.insert(categoryCalibration)
			.values({
				categoryId,
				betaEstimate: clampedBeta.toFixed(4),
				nObservations: n,
				fitQuality: r2.toFixed(4),
			})
			.onConflictDoUpdate({
				target: categoryCalibration.categoryId,
				set: {
					betaEstimate: clampedBeta.toFixed(4),
					nObservations: n,
					fitQuality: r2.toFixed(4),
					lastFitAt: sql`now()`,
				},
			});

		results.push({ categoryId, beta: clampedBeta, n, r2 });
	}

	return results;
}

/**
 * Read the fitted β for a category, falling back to undefined when no
 * fit exists yet. Caller (`categoryBeta` in lifecycle.ts) layers the
 * hardcoded default below this.
 */
export async function fittedBetaFor(categoryId: string): Promise<number | undefined> {
	const [row] = await db
		.select({ beta: categoryCalibration.betaEstimate })
		.from(categoryCalibration)
		.where(eq(categoryCalibration.categoryId, categoryId))
		.limit(1);
	if (!row) return undefined;
	const n = Number.parseFloat(row.beta);
	return Number.isFinite(n) ? n : undefined;
}
