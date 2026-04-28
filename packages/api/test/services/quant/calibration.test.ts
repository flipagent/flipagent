import { describe, expect, it } from "vitest";
import { calibrate } from "../../../src/services/quant/calibration.js";
import type { PredictionRecord } from "../../../src/services/quant/types.js";

describe("calibrate", () => {
	it("returns a zero placeholder for empty input", () => {
		const c = calibrate([]);
		expect(c.n).toBe(0);
		expect(c.netBiasCents).toBe(0);
		expect(c.netCalibration).toBe(1);
	});

	it("computes bias, MAE, and underestimate rate", () => {
		const records: PredictionRecord[] = [
			{ predictedNetCents: 1000, actualNetCents: 900 }, // over-predict by 100
			{ predictedNetCents: 1000, actualNetCents: 1100 }, // under-predict by 100
			{ predictedNetCents: 1000, actualNetCents: 1100 }, // under-predict by 100
		];
		const c = calibrate(records);
		expect(c.n).toBe(3);
		expect(c.netBiasCents).toBe(Math.round((100 - 100 - 100) / 3)); // mean(predicted - actual) = -33
		expect(c.netMaeCents).toBe(100);
		expect(c.underestimateRate).toBeCloseTo(2 / 3, 6);
	});

	it("netCalibration multiplier = sum(actual)/sum(predicted)", () => {
		const records: PredictionRecord[] = [
			{ predictedNetCents: 1000, actualNetCents: 900 },
			{ predictedNetCents: 2000, actualNetCents: 1800 },
		];
		const c = calibrate(records);
		expect(c.netCalibration).toBeCloseTo(2700 / 3000, 6);
	});

	it("aggregates time-to-sell metrics when both fields present", () => {
		const records: PredictionRecord[] = [
			{ predictedNetCents: 1000, actualNetCents: 1000, predictedDaysToSell: 14, actualDaysToSell: 21 },
			{ predictedNetCents: 1000, actualNetCents: 1000, predictedDaysToSell: 14, actualDaysToSell: 7 },
		];
		const c = calibrate(records);
		expect(c.daysBias).toBe(0); // (14-21 + 14-7) / 2 = 0
		expect(c.daysMae).toBe(7);
	});

	it("leaves day metrics undefined when records lack duration data", () => {
		const records: PredictionRecord[] = [{ predictedNetCents: 1000, actualNetCents: 900 }];
		const c = calibrate(records);
		expect(c.daysBias).toBeUndefined();
		expect(c.daysMae).toBeUndefined();
	});
});
