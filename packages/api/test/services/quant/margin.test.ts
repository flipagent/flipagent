import { describe, expect, it } from "vitest";
import { bidCeiling, netMargin } from "../../../src/services/quant/margin.js";

describe("netMargin", () => {
	it("clears when net is positive (default floor 0)", () => {
		const r = netMargin({ estimatedSaleCents: 10_000, buyPriceCents: 5000 });
		expect(r.cleared).toBe(true);
		expect(r.netCents).toBeGreaterThan(0);
	});

	it("rejects when buy price drives net negative", () => {
		const r = netMargin({ estimatedSaleCents: 10_000, buyPriceCents: 9000 });
		expect(r.cleared).toBe(false);
		expect(r.netCents).toBeLessThan(0);
	});

	it("subtracts shipping costs", () => {
		const a = netMargin({ estimatedSaleCents: 10_000, buyPriceCents: 5000 });
		const b = netMargin({
			estimatedSaleCents: 10_000,
			buyPriceCents: 5000,
			inboundShippingCents: 800,
			outboundShippingCents: 700,
		});
		expect(b.netCents).toBe(a.netCents - 1500);
	});

	it("applies promoted listings rate", () => {
		const base = netMargin({ estimatedSaleCents: 10_000, buyPriceCents: 5000 });
		const promoted = netMargin({
			estimatedSaleCents: 10_000,
			buyPriceCents: 5000,
			fees: { feeRate: 0.1325, fixedCents: 30, promotionRate: 0.1 },
		});
		expect(promoted.netCents).toBe(base.netCents - 1000);
	});
});

describe("bidCeiling", () => {
	it("inverts netMargin", () => {
		const sale = 10_000;
		const target = 3000;
		const maxBuy = bidCeiling(sale, target);
		const back = netMargin({ estimatedSaleCents: sale, buyPriceCents: maxBuy });
		expect(back.netCents).toBeGreaterThanOrEqual(target - 1);
		expect(back.netCents).toBeLessThanOrEqual(target + 1);
	});
});
