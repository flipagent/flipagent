import { describe, expect, it } from "vitest";
import { dimWeightG, estimateForwarderFee } from "../../../src/services/forwarder/estimate.js";
import { zoneBandFor } from "../../../src/services/forwarder/zones.js";

describe("estimateForwarderFee — planet-express US-domestic", () => {
	it("default service is USPS Priority, zone band resolved from CA", () => {
		const q = estimateForwarderFee("planet-express", { weightG: 800, destState: "NY" });
		expect(q.providerId).toBe("planet-express");
		expect(q.service).toBe("usps_priority");
		expect(q.zoneBand).toBe("east");
		expect(q.handlingCents).toBe(500);
		expect(q.shippingCents).toBeGreaterThan(0);
		expect(q.totalCents).toBe(q.handlingCents + q.shippingCents);
	});

	it("local CA → CA is cheaper than CA → east", () => {
		const local = estimateForwarderFee("planet-express", { weightG: 1500, destState: "CA" });
		const east = estimateForwarderFee("planet-express", { weightG: 1500, destState: "NY" });
		expect(local.shippingCents).toBeLessThan(east.shippingCents);
		expect(local.zoneBand).toBe("local");
		expect(east.zoneBand).toBe("east");
	});

	it("UPS Ground beats USPS Priority on heavy boxes east-bound", () => {
		const usps = estimateForwarderFee("planet-express", {
			weightG: 6000,
			destState: "NY",
			service: "usps_priority",
		});
		const ups = estimateForwarderFee("planet-express", {
			weightG: 6000,
			destState: "NY",
			service: "ups_ground",
		});
		expect(ups.shippingCents).toBeLessThan(usps.shippingCents);
	});

	it("flags UPS Ground as not serving AK/HI", () => {
		const q = estimateForwarderFee("planet-express", {
			weightG: 800,
			destState: "HI",
			service: "ups_ground",
		});
		expect(q.zoneBand).toBe("offshore");
		expect(q.caveats.some((c) => c.includes("does not serve AK/HI"))).toBe(true);
	});

	it("adds per-extra-item handling for consolidations", () => {
		const single = estimateForwarderFee("planet-express", { weightG: 1500, destState: "TX", itemCount: 1 });
		const triple = estimateForwarderFee("planet-express", { weightG: 1500, destState: "TX", itemCount: 3 });
		expect(triple.handlingCents - single.handlingCents).toBe(2 * 50);
	});

	it("bills on dim weight when larger than actual", () => {
		const q = estimateForwarderFee("planet-express", {
			weightG: 300,
			dimsCm: { l: 40, w: 30, h: 30 },
			destState: "NY",
		});
		expect(q.chargeableWeightG).toBeGreaterThan(300);
		expect(q.caveats.some((c) => c.startsWith("Billed on dim weight"))).toBe(true);
	});

	it("ETA shrinks for closer destinations", () => {
		const local = estimateForwarderFee("planet-express", { weightG: 800, destState: "CA" });
		const east = estimateForwarderFee("planet-express", { weightG: 800, destState: "NY" });
		expect(local.etaDays[1]).toBeLessThanOrEqual(east.etaDays[0]);
	});

	it("throws for unknown provider", () => {
		expect(() => estimateForwarderFee("nope-forwarder", { weightG: 500, destState: "NY" })).toThrow(
			/Unknown forwarder provider/,
		);
	});
});

describe("zoneBandFor", () => {
	it("CA → CA is local", () => {
		expect(zoneBandFor("CA", "CA")).toBe("local");
	});

	it("CA → AZ is west", () => {
		expect(zoneBandFor("CA", "AZ")).toBe("west");
	});

	it("CA → TX is central", () => {
		expect(zoneBandFor("CA", "TX")).toBe("central");
	});

	it("CA → NY is east", () => {
		expect(zoneBandFor("CA", "NY")).toBe("east");
	});

	it("CA → HI is offshore", () => {
		expect(zoneBandFor("CA", "HI")).toBe("offshore");
	});

	it("unknown origin defaults to east for any CONUS dest", () => {
		expect(zoneBandFor("ZZ", "NY")).toBe("east");
	});
});

describe("dimWeightG", () => {
	it("matches DHL convention at divisor 5000", () => {
		expect(dimWeightG({ l: 30, w: 20, h: 10 }, 5000)).toBe(1200);
	});
});
