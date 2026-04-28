import { describe, expect, it } from "vitest";
import { assertUrlAllowed, DisallowedUrlError } from "../src/robots-guard.js";

describe("assertUrlAllowed", () => {
	it("allows the canonical /itm/{id} detail URL", () => {
		expect(() => assertUrlAllowed("https://www.ebay.com/itm/123456789012")).not.toThrow();
	});

	it("allows /sch/i.html search URLs (knowingly out of scope per compliance doc)", () => {
		expect(() => assertUrlAllowed("https://www.ebay.com/sch/i.html?_nkw=iphone&_sacat=0&_pgn=1")).not.toThrow();
	});

	it("allows non-ebay hosts to pass through", () => {
		expect(() => assertUrlAllowed("https://example.com/anything")).not.toThrow();
	});

	it("blocks /itm/addToCart", () => {
		expect(() => assertUrlAllowed("https://www.ebay.com/itm/addToCart?id=123")).toThrow(DisallowedUrlError);
	});

	it("blocks /itm/watch/", () => {
		expect(() => assertUrlAllowed("https://www.ebay.com/itm/watch/123456789")).toThrow(DisallowedUrlError);
	});

	it("blocks /itm/*action=BESTOFFER", () => {
		expect(() => assertUrlAllowed("https://www.ebay.com/itm/123456789?action=BESTOFFER")).toThrow(DisallowedUrlError);
	});

	it("blocks /itm/*?fits", () => {
		expect(() => assertUrlAllowed("https://www.ebay.com/itm/123456789?fits=somecar")).toThrow(DisallowedUrlError);
	});

	it("blocks .jpg under /itm", () => {
		expect(() => assertUrlAllowed("https://www.ebay.com/itm/photo.jpg")).toThrow(DisallowedUrlError);
	});

	it("blocks /itm/sellerInfoV2", () => {
		expect(() => assertUrlAllowed("https://www.ebay.com/itm/sellerInfoV2?id=1")).toThrow(DisallowedUrlError);
	});

	it("blocks cart and seller-tools subpaths", () => {
		expect(() => assertUrlAllowed("https://www.ebay.com/cart")).toThrow(DisallowedUrlError);
		expect(() => assertUrlAllowed("https://www.ebay.com/sl/sell")).toThrow(DisallowedUrlError);
		expect(() => assertUrlAllowed("https://www.ebay.com/myebay/")).toThrow(DisallowedUrlError);
	});

	it("works on regional eBay TLDs (ebay.de, ebay.co.uk)", () => {
		expect(() => assertUrlAllowed("https://www.ebay.de/itm/addToCart")).toThrow(DisallowedUrlError);
		expect(() => assertUrlAllowed("https://www.ebay.co.uk/itm/watch/123")).toThrow(DisallowedUrlError);
	});

	it("includes the matched pattern in the error", () => {
		try {
			assertUrlAllowed("https://www.ebay.com/itm/addToCart");
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(DisallowedUrlError);
			expect((err as DisallowedUrlError).pattern).toBe("/itm/addToCart");
		}
	});

	it("ignores garbage input rather than crashing", () => {
		expect(() => assertUrlAllowed("not a url")).not.toThrow();
	});
});
