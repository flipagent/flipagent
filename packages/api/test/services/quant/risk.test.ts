import { describe, expect, it } from "vitest";
import { assessRisk } from "../../../src/services/quant/risk.js";

// Helper: compute true E[net] = (1 − P) × successNet − P × maxLoss
function expectedNet(P_fraud: number, successNet: number, maxLoss: number): number {
	return (1 - P_fraud) * successNet - P_fraud * maxLoss;
}

describe("assessRisk (Bayesian P_fraud)", () => {
	it("trusted seller (1500fb, 99.5%) + fast sale → very low P, expected ≈ success", () => {
		const r = assessRisk({
			sellerFeedbackScore: 1500,
			sellerFeedbackPercent: 99.5,
			buyPriceCents: 20000,
			acceptsReturns: true,
			returnWindowDays: 30,
			returnShipPaidBy: "buyer",
			expectedDaysToSell: 5,
		});
		expect(r.P_fraud).toBeLessThan(0.01); // posterior tightly concentrated
		expect(r.withinReturnWindow).toBe(true);
		expect(r.maxLossCents).toBe(1500);
	});

	it("100% on 1 feedback → moderate P (not 0%)", () => {
		// User intuition: 1/1 isn't informative. Bayesian smoothing
		// keeps posterior close to prior.
		const r = assessRisk({
			sellerFeedbackScore: 1,
			sellerFeedbackPercent: 100,
			buyPriceCents: 20000,
			acceptsReturns: true,
			returnWindowDays: 30,
			returnShipPaidBy: "buyer",
			expectedDaysToSell: 5,
		});
		// 1/1 100% → posterior Beta(6, 0.05). mean ≈ 0.83%, std ≈ 3.4%, P ≈ 4.2%.
		expect(r.P_fraud).toBeGreaterThan(0.02);
		expect(r.P_fraud).toBeLessThan(0.07);
	});

	it("100% on 1000 feedback → near-zero P (data drives posterior)", () => {
		const r = assessRisk({
			sellerFeedbackScore: 1000,
			sellerFeedbackPercent: 100,
			buyPriceCents: 20000,
			acceptsReturns: true,
			returnWindowDays: 30,
			returnShipPaidBy: "buyer",
			expectedDaysToSell: 5,
		});
		expect(r.P_fraud).toBeLessThan(0.001);
	});

	it("count + percent jointly: 95% on 100fb < 95% on 10fb (uncertainty)", () => {
		const big = assessRisk({
			sellerFeedbackScore: 100,
			sellerFeedbackPercent: 95,
			buyPriceCents: 20000,
			acceptsReturns: true,
			returnWindowDays: 30,
			returnShipPaidBy: "buyer",
			expectedDaysToSell: 5,
		});
		const small = assessRisk({
			sellerFeedbackScore: 10,
			sellerFeedbackPercent: 95,
			buyPriceCents: 20000,
			acceptsReturns: true,
			returnWindowDays: 30,
			returnShipPaidBy: "buyer",
			expectedDaysToSell: 5,
		});
		// Same percent, but small sample has wider posterior → higher upper bound
		expect(small.P_fraud).toBeGreaterThan(big.P_fraud);
	});

	it("low % feedback (95%) penalizes more than 99% at same count", () => {
		const high = assessRisk({
			sellerFeedbackScore: 500,
			sellerFeedbackPercent: 99,
			buyPriceCents: 20000,
			acceptsReturns: true,
			returnWindowDays: 30,
			returnShipPaidBy: "buyer",
			expectedDaysToSell: 5,
		});
		const low = assessRisk({
			sellerFeedbackScore: 500,
			sellerFeedbackPercent: 95,
			buyPriceCents: 20000,
			acceptsReturns: true,
			returnWindowDays: 30,
			returnShipPaidBy: "buyer",
			expectedDaysToSell: 5,
		});
		expect(low.P_fraud).toBeGreaterThan(high.P_fraud * 2);
	});

	it("seller does not accept returns → maxLoss = full buy regardless", () => {
		const r = assessRisk({
			sellerFeedbackScore: 500,
			sellerFeedbackPercent: 99,
			buyPriceCents: 20000,
			acceptsReturns: false,
			expectedDaysToSell: 5,
		});
		expect(r.withinReturnWindow).toBe(false);
		expect(r.maxLossCents).toBe(20000);
	});

	it("free returns (seller pays) → maxLoss is 0", () => {
		const r = assessRisk({
			sellerFeedbackScore: 500,
			sellerFeedbackPercent: 99,
			buyPriceCents: 20000,
			acceptsReturns: true,
			returnWindowDays: 30,
			returnShipPaidBy: "seller",
			expectedDaysToSell: 5,
		});
		expect(r.withinReturnWindow).toBe(true);
		expect(r.maxLossCents).toBe(0);
		// expectedNet at success $60 with maxLoss 0:
		// E[net] = (1−P)×60 − P×0 = 60 × (1−P)
		const eNet = expectedNet(r.P_fraud, 6000, r.maxLossCents);
		expect(Math.round(eNet)).toBeGreaterThan(5900); // basically success
	});

	it("missing seller data → moderate fallback (~5%)", () => {
		const r = assessRisk({
			buyPriceCents: 20000,
			acceptsReturns: true,
			returnWindowDays: 30,
			returnShipPaidBy: "buyer",
			expectedDaysToSell: 5,
		});
		// No data → posterior = prior. mean ≈ 1%, std ≈ 4%, P ≈ 5%.
		// Conservative fallback (uncertainty wide for 0 observations).
		expect(r.P_fraud).toBeGreaterThan(0.03);
		expect(r.P_fraud).toBeLessThan(0.07);
	});

	it("low-count + bad % (drop-shipper 5fb 90%) → moderate P (statistically honest)", () => {
		const r = assessRisk({
			sellerFeedbackScore: 5,
			sellerFeedbackPercent: 90,
			buyPriceCents: 20000,
			acceptsReturns: false,
			expectedDaysToSell: 5,
		});
		// Posterior reflects "not enough data to confidently classify as fraudster."
		// Around 12-15% — meaningful but not an extreme number.
		expect(r.P_fraud).toBeGreaterThan(0.05);
		expect(r.P_fraud).toBeLessThan(0.2);
		expect(r.maxLossCents).toBe(20000);
	});

	it("cycleDays exceeds returnWindowDays → maxLoss = full buy", () => {
		const r = assessRisk({
			sellerFeedbackScore: 1000,
			sellerFeedbackPercent: 99,
			buyPriceCents: 50000,
			acceptsReturns: true,
			returnWindowDays: 30,
			returnShipPaidBy: "buyer",
			expectedDaysToSell: 25, // cycle = 36 > 30
		});
		expect(r.withinReturnWindow).toBe(false);
		expect(r.maxLossCents).toBe(50000);
	});
});
