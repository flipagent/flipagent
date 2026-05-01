/**
 * `summariseDetail` is the prompt builder that hands a candidate or
 * pool item to the verify-pass LLM. The bug we just fixed: it ignored
 * `variations[]` on multi-SKU listings, so the LLM saw only the page's
 * generic top-of-fold aspects and couldn't tell PS 3Y kids' shoes
 * apart from US M8 men's at the same brand+title. With variations
 * rendered, the LLM has the per-SKU price + axis values to pick the
 * right one.
 */

import { describe, expect, it } from "vitest";
import { __summariseDetailForTest as summariseDetail } from "../../../src/services/match/matcher.js";

describe("summariseDetail — multi-variation rendering", () => {
	it("emits one line per variation with axis values + price", () => {
		const out = summariseDetail({
			title: "Nike Air Jordan 4 Retro Black Cat 2025",
			brand: "Nike",
			price: { value: "359.90", currency: "USD" },
			variations: [
				{
					variationId: "626382683495",
					priceCents: 35990,
					currency: "USD",
					aspects: [{ name: "Size", value: "US M8 / W9.5" }],
				},
				{
					variationId: "626578342371",
					priceCents: 13500,
					currency: "USD",
					aspects: [{ name: "Size", value: "PS 3Y / W4.5" }],
				},
			],
		});
		expect(out).toContain("variations (2 SKUs in this listing):");
		expect(out).toContain("- Size: US M8 / W9.5 — $359.90");
		expect(out).toContain("- Size: PS 3Y / W4.5 — $135.00");
	});

	it("renders multi-axis variations as `axis: value, axis: value`", () => {
		const out = summariseDetail({
			title: "Hoodie",
			variations: [
				{
					variationId: "1",
					priceCents: 5000,
					currency: "USD",
					aspects: [
						{ name: "Size", value: "L" },
						{ name: "Color", value: "Black" },
					],
				},
			],
		});
		expect(out).toContain("- Size: L, Color: Black — $50.00");
	});

	it("renders `(no aspect)` when a variation has no axis values", () => {
		const out = summariseDetail({
			title: "Mystery SKU",
			variations: [{ variationId: "x", priceCents: 1000, currency: "USD", aspects: [] }],
		});
		expect(out).toContain("- (no aspect) — $10.00");
	});

	it("renders `n/a` for missing prices", () => {
		const out = summariseDetail({
			title: "Stockless SKU",
			variations: [{ variationId: "x", priceCents: null, currency: "USD", aspects: [{ name: "Size", value: "S" }] }],
		});
		expect(out).toContain("- Size: S — n/a");
	});

	it("omits the variations block on single-SKU listings", () => {
		const out = summariseDetail({
			title: "Canon EF 50mm",
			brand: "Canon",
			price: { value: "95.00", currency: "USD" },
		});
		expect(out).not.toContain("variations");
		expect(out).toContain("title: Canon EF 50mm");
	});
});
