/**
 * Phase 5 (RECONCILE) — model feedback loop. Take a batch of
 * predicted-vs-actual records and report bias, accuracy, and a
 * multiplicative correction factor.
 *
 * The expected use is:
 *   1. After each settled trade, persist a `PredictionRecord`
 *      somewhere durable (the api's Postgres).
 *   2. Periodically (weekly) feed the last N records to `calibrate`.
 *   3. Apply the returned `netCalibration` as a multiplier on future
 *      `score().netCents` predictions if it drifts significantly
 *      below or above 1.0.
 *
 * Quant doesn't store the records — that's a data-plane concern. This
 * module is pure stat over whatever the caller hands in.
 */

import type { Calibration, PredictionRecord } from "./types.js";

/**
 * Compute calibration metrics from a batch of (predicted, actual)
 * records. Returns `n: 0` placeholder when fed an empty batch (no
 * exception, easier to compose).
 */
export function calibrate(records: ReadonlyArray<PredictionRecord>): Calibration {
	if (records.length === 0) {
		return {
			n: 0,
			netBiasCents: 0,
			netMaeCents: 0,
			underestimateRate: 0,
			netCalibration: 1,
		};
	}

	let sumErr = 0;
	let sumAbs = 0;
	let underCount = 0;
	let sumPredicted = 0;
	let sumActual = 0;

	let dayN = 0;
	let dayErrSum = 0;
	let dayAbsSum = 0;

	for (const r of records) {
		const err = r.predictedNetCents - r.actualNetCents;
		sumErr += err;
		sumAbs += Math.abs(err);
		if (r.actualNetCents > r.predictedNetCents) underCount++;
		sumPredicted += r.predictedNetCents;
		sumActual += r.actualNetCents;

		if (typeof r.predictedDaysToSell === "number" && typeof r.actualDaysToSell === "number") {
			const dErr = r.predictedDaysToSell - r.actualDaysToSell;
			dayErrSum += dErr;
			dayAbsSum += Math.abs(dErr);
			dayN++;
		}
	}

	const n = records.length;
	const out: Calibration = {
		n,
		netBiasCents: Math.round(sumErr / n),
		netMaeCents: Math.round(sumAbs / n),
		underestimateRate: underCount / n,
		// netCalibration multiplier = actual / predicted (sum-form). Multiply
		// future predictions by this for an unbiased estimate. Falls back to
		// 1 when sumPredicted is non-positive.
		netCalibration: sumPredicted > 0 ? sumActual / sumPredicted : 1,
	};
	if (dayN > 0) {
		out.daysBias = dayErrSum / dayN;
		out.daysMae = dayAbsSum / dayN;
	}
	return out;
}
