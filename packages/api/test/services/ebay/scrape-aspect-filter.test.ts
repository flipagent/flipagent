/**
 * `parseAspectFilter` translates eBay's `aspect_filter` Browse-spec
 * expression into the categoryId + per-aspect dict that the web-SRP
 * URL builder consumes. The function is the bridge between the REST
 * mirror's `aspect_filter=categoryId:N,Color:{Black}` syntax and the
 * SRP's `&_dcat=N&Color=Black` form.
 */

import { describe, expect, it } from "vitest";
import { parseAspectFilter } from "../../../src/services/ebay/scrape/client.js";

describe("parseAspectFilter", () => {
	it("extracts categoryId + multiple aspects, single value each", () => {
		const out = parseAspectFilter("categoryId:11450,Color:{Black},Size:{8}");
		expect(out).toEqual({
			categoryId: "11450",
			aspects: { Color: "Black", Size: "8" },
		});
	});

	it("preserves pipe-joined multi-values in the aspect dict", () => {
		const out = parseAspectFilter("categoryId:15709,Color:{Black|White|Red}");
		expect(out.aspects.Color).toBe("Black|White|Red");
	});

	it("handles aspect names with spaces (e.g. `US Shoe Size`)", () => {
		const out = parseAspectFilter("categoryId:15709,US Shoe Size:{8|9}");
		expect(out.aspects["US Shoe Size"]).toBe("8|9");
	});

	it("returns aspects-only when categoryId is omitted (eBay's spec REQUIRES it but we tolerate)", () => {
		const out = parseAspectFilter("Brand:{Nike}");
		expect(out.categoryId).toBeUndefined();
		expect(out.aspects.Brand).toBe("Nike");
	});

	it("ignores malformed segments gracefully", () => {
		const out = parseAspectFilter("categoryId:11450,no-colon-here,Color:{Black}");
		expect(out.categoryId).toBe("11450");
		expect(out.aspects).toEqual({ Color: "Black" });
	});

	it("returns empty aspects on empty input", () => {
		expect(parseAspectFilter("")).toEqual({ aspects: {} });
	});
});
