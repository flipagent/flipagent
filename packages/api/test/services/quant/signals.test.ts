import { describe, expect, it } from "vitest";
import { brandTypo, generateBrandTypos } from "../../../src/services/quant/signals/brand-typo.js";
import { belowAsks } from "../../../src/services/quant/signals/competition.js";
import { endingSoonLowWatchers } from "../../../src/services/quant/signals/ending-soon.js";
import { poorTitle } from "../../../src/services/quant/signals/poor-title.js";
import { underMedian } from "../../../src/services/quant/signals/under-median.js";
import type { MarketStats, QuantListing } from "../../../src/services/quant/types.js";

const market: MarketStats = {
	keyword: "canon ef 50mm",
	marketplace: "EBAY_US",
	windowDays: 30,
	meanCents: 10_200,
	stdDevCents: 1_500,
	medianCents: 10_000,
	p25Cents: 8_000,
	p75Cents: 12_000,
	nObservations: 100,
	salesPerDay: 100 / 30,
	asOf: "2026-04-25T00:00:00Z",
};

const baseQuantListing: QuantListing = {
	itemId: "1",
	title: "Canon EF 50mm f/1.8 STM Lens — excellent condition with caps and box",
	url: "https://www.ebay.com/itm/1",
	priceCents: 7_000,
	currency: "USD",
};

describe("underMedian", () => {
	it("fires for listings under the median", () => {
		const sig = underMedian(baseQuantListing, market);
		expect(sig?.kind).toBe("under_median");
		expect(sig?.strength).toBeGreaterThan(0);
	});

	it("does not fire when above median", () => {
		const expensive = { ...baseQuantListing, priceCents: 12_000 };
		expect(underMedian(expensive, market)).toBeNull();
	});
});

describe("endingSoonLowWatchers", () => {
	it("fires for AUCTION ending in <1h with no watchers", () => {
		const now = new Date("2026-04-25T12:00:00Z");
		const listing: QuantListing = {
			...baseQuantListing,
			buyingFormat: "AUCTION",
			endTime: "2026-04-25T12:30:00Z",
			watchCount: 0,
			bidCount: 0,
		};
		const sig = endingSoonLowWatchers(listing, now);
		expect(sig?.kind).toBe("ending_soon_low_watchers");
	});

	it("does not fire when bids are present", () => {
		const now = new Date("2026-04-25T12:00:00Z");
		const listing: QuantListing = {
			...baseQuantListing,
			buyingFormat: "AUCTION",
			endTime: "2026-04-25T12:30:00Z",
			bidCount: 2,
		};
		expect(endingSoonLowWatchers(listing, now)).toBeNull();
	});
});

describe("generateBrandTypos", () => {
	it("includes plausible typos for canon", () => {
		const typos = generateBrandTypos("Canon");
		expect(typos.length).toBeGreaterThan(2);
		expect(typos).toContain("cannon");
	});

	it("does not return the original", () => {
		const typos = generateBrandTypos("Rolex");
		expect(typos).not.toContain("rolex");
	});
});

describe("brandTypo", () => {
	it("matches title with misspelled brand", () => {
		const listing = { ...baseQuantListing, title: "Cannon 50mm 1.8 STM lens box" };
		const sig = brandTypo(listing, "Canon");
		expect(sig?.kind).toBe("brand_typo");
	});
});

describe("poorTitle", () => {
	it("flags ALL CAPS short titles", () => {
		const listing = { ...baseQuantListing, title: "CANON LENS L@@K" };
		const sig = poorTitle(listing);
		expect(sig?.kind).toBe("poor_title");
	});
});

describe("belowAsks", () => {
	const marketWithAsks: MarketStats = {
		...market,
		asks: {
			meanCents: 11_000,
			stdDevCents: 1_000,
			medianCents: 11_000,
			p25Cents: 9_500,
			p75Cents: 12_500,
			nActive: 40,
		},
	};

	it("fires when listing price ≤ p25 of active asks", () => {
		const cheap: QuantListing = { ...baseQuantListing, priceCents: 8_000 };
		const sig = belowAsks(cheap, marketWithAsks);
		expect(sig?.kind).toBe("below_asks");
		expect(sig?.strength).toBeGreaterThan(0);
	});

	it("does not fire when above asks p25", () => {
		const market_priced = { ...baseQuantListing, priceCents: 10_500 };
		expect(belowAsks(market_priced, marketWithAsks)).toBeNull();
	});

	it("returns null when market has no asks", () => {
		expect(belowAsks(baseQuantListing, market)).toBeNull();
	});
});
