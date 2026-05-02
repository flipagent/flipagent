import { describe, expect, it } from "vitest";
import { scrubMessageBody } from "../../../src/services/ebay/trading/message-hygiene.js";

describe("scrubMessageBody", () => {
	it("returns the input unchanged when no PII patterns match", () => {
		const out = scrubMessageBody("Thanks for your purchase! Tracking is on its way.");
		expect(out.cleanBody).toBe("Thanks for your purchase! Tracking is on its way.");
		expect(out.redactions).toHaveLength(0);
	});

	it("redacts an email address and lists the redaction", () => {
		const out = scrubMessageBody("Reach me at seller@example.com for offers.");
		expect(out.cleanBody).toContain("[email removed]");
		expect(out.cleanBody).not.toContain("seller@example.com");
		expect(out.redactions).toEqual([{ kind: "email", original: "seller@example.com" }]);
	});

	it("redacts US-style phone numbers", () => {
		const out = scrubMessageBody("Call me: +1 415-555-1212");
		expect(out.cleanBody).toContain("[phone removed]");
		expect(out.redactions[0].kind).toBe("phone");
	});

	it("redacts non-eBay URLs", () => {
		const out = scrubMessageBody("Visit https://shopify-store.example/widget for details.");
		expect(out.cleanBody).toContain("[link removed]");
		expect(out.redactions[0].kind).toBe("url");
	});

	it("preserves eBay URLs (legitimate item / message links)", () => {
		const out = scrubMessageBody("See the item here: https://www.ebay.com/itm/123456789");
		expect(out.cleanBody).toContain("ebay.com/itm/123456789");
		expect(out.redactions).toHaveLength(0);
	});

	it("preserves bare ebay.com domains", () => {
		const out = scrubMessageBody("Your shipping settings live at ebay.com.");
		expect(out.cleanBody).toContain("ebay.com");
		expect(out.redactions).toHaveLength(0);
	});

	it("redacts multiple distinct categories in one message", () => {
		const out = scrubMessageBody("Email me@x.com or call (415) 555-0000 — see myshop.example.com.");
		const kinds = out.redactions.map((r) => r.kind).sort();
		expect(kinds).toEqual(["email", "phone", "url"]);
	});
});
