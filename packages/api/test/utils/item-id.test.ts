import { describe, expect, it } from "vitest";
import { legacyFromV1, parseItemId, toLegacyId } from "../../src/utils/item-id.js";

describe("parseItemId", () => {
	it("parses bare legacy numeric id", () => {
		expect(parseItemId("357966166544")).toEqual({ legacyId: "357966166544" });
	});

	it("parses v1|N|0 as parent (no variation)", () => {
		expect(parseItemId("v1|357966166544|0")).toEqual({ legacyId: "357966166544" });
	});

	it("parses v1|N|V and surfaces variationId when not the parent sentinel", () => {
		expect(parseItemId("v1|357966166544|626382683495")).toEqual({
			legacyId: "357966166544",
			variationId: "626382683495",
		});
	});

	it("parses an eBay /itm/ URL and pulls the variationId from ?var=", () => {
		expect(parseItemId("https://www.ebay.com/itm/357966166544?var=626382683495")).toEqual({
			legacyId: "357966166544",
			variationId: "626382683495",
		});
	});

	it("parses an eBay /itm/ URL with extra tracking params and finds ?var=", () => {
		expect(
			parseItemId("https://www.ebay.com/itm/357966166544?var=626382683495&itmmeta=01KQJ&hash=item5358723a10"),
		).toEqual({ legacyId: "357966166544", variationId: "626382683495" });
	});

	it("parses an /itm/ URL with no var", () => {
		expect(parseItemId("https://www.ebay.com/itm/357966166544")).toEqual({
			legacyId: "357966166544",
		});
	});

	it("ignores ?var=0 (eBay's parent sentinel)", () => {
		expect(parseItemId("https://www.ebay.com/itm/357966166544?var=0")).toEqual({
			legacyId: "357966166544",
		});
	});

	it("handles slug-prefixed /itm/<slug>/<id> URLs", () => {
		expect(parseItemId("https://www.ebay.com/itm/Some-Slug-Here/357966166544?var=42")).toEqual({
			legacyId: "357966166544",
			variationId: "42",
		});
	});

	it("returns null for empty / malformed inputs", () => {
		expect(parseItemId("")).toBeNull();
		expect(parseItemId(null)).toBeNull();
		expect(parseItemId(undefined)).toBeNull();
		expect(parseItemId("not-an-id")).toBeNull();
		expect(parseItemId("v1|abc|0")).toBeNull();
		expect(parseItemId("https://www.ebay.com/sch/i.html?_nkw=foo")).toBeNull();
	});

	it("trims surrounding whitespace", () => {
		expect(parseItemId("  357966166544  ")).toEqual({ legacyId: "357966166544" });
	});
});

describe("legacyFromV1 (legacy callers)", () => {
	it("strips both v1 prefix and trailing variation segment", () => {
		expect(legacyFromV1("v1|357966166544|0")).toBe("357966166544");
		expect(legacyFromV1("v1|357966166544|626382683495")).toBe("357966166544");
	});

	it("returns the input unchanged when no wrapper is present", () => {
		expect(legacyFromV1("357966166544")).toBe("357966166544");
	});

	it("returns null on empty input", () => {
		expect(legacyFromV1(null)).toBeNull();
		expect(legacyFromV1(undefined)).toBeNull();
	});
});

describe("toLegacyId", () => {
	it("prefers legacyItemId when present", () => {
		expect(toLegacyId({ legacyItemId: "357966166544", itemId: "v1|999|0" })).toBe("357966166544");
	});

	it("falls back to itemId v1 unwrapping", () => {
		expect(toLegacyId({ itemId: "v1|357966166544|626382683495" })).toBe("357966166544");
	});

	it("returns null when neither field carries a 6+ digit id", () => {
		expect(toLegacyId({})).toBeNull();
		expect(toLegacyId({ itemId: "abc" })).toBeNull();
	});
});
