/**
 * `summariseDetail` is the prompt builder that hands a candidate or
 * pool item to the verify-pass LLM. Multi-SKU listings render their
 * variations[] block as `axis: value` lines so the LLM can confirm
 * the seed's specific variant exists in the listing (Rule 3 path 2).
 *
 * Top-level listing price + per-variation prices are intentionally
 * OMITTED — the matcher decides product identity only; price-based
 * fraud / "too cheap to be real" reasoning belongs to the downstream
 * `evaluate/suspicious.ts` filter. Showing price here primed the LLM
 * to rationalize low-price comps as "different model" (BoomX seed:
 * same title at $70 → match, $79 → reject, only differentiator was
 * price).
 */

import { describe, expect, it } from "vitest";
import { __summariseDetailForTest as summariseDetail } from "../../../src/services/match/matcher.js";

describe("summariseDetail — multi-variation rendering", () => {
	it("emits one line per variation with axis values (no price)", () => {
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
		expect(out).toContain("- Size: US M8 / W9.5");
		expect(out).toContain("- Size: PS 3Y / W4.5");
		expect(out).not.toMatch(/\$\d/);
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
		expect(out).toContain("- Size: L, Color: Black");
		expect(out).not.toMatch(/\$\d/);
	});

	it("renders `(no aspect)` when a variation has no axis values", () => {
		const out = summariseDetail({
			title: "Mystery SKU",
			variations: [{ variationId: "x", priceCents: 1000, currency: "USD", aspects: [] }],
		});
		expect(out).toContain("- (no aspect)");
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

	it("omits top-level price + marketingPrice — matcher is identity-only", () => {
		const out = summariseDetail({
			title: "iPhone 15 Pro 256GB",
			price: { value: "899.00", currency: "USD" },
			marketingPrice: {
				originalPrice: { value: "1199.00", currency: "USD" },
				discountPercentage: "25",
			},
		});
		expect(out).not.toContain("$899");
		expect(out).not.toContain("$1199");
		expect(out).not.toContain("price:");
		expect(out).not.toContain("marketingPrice:");
	});
});
