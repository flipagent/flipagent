/**
 * REST URL-builder coverage. The `fetchActiveSearchRest` /
 * `fetchSoldSearchRest` helpers compose eBay's `?q=...&filter=...&...`
 * query string from our typed query objects. Full eBay-spec param set
 * must round-trip verbatim — `aspect_filter`, `gtin`, `epid`,
 * `fieldgroups`, `auto_correct`, `compatibility_filter`, `charity_ids`
 * for active; the subset that Marketplace Insights supports for sold.
 *
 * We mock `fetchRetry` + the OAuth fetcher and assert the URL that
 * lands at the network boundary. Body parse is irrelevant for these
 * cases — we return an empty 200 envelope.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/services/ebay/oauth.js", () => ({
	getAppAccessToken: vi.fn().mockResolvedValue("test_token"),
}));

const fetchRetryMock = vi.fn();
vi.mock("../../../src/utils/fetch-retry.js", () => ({
	fetchRetry: (...args: unknown[]) => fetchRetryMock(...args),
}));

import { fetchActiveSearchRest, fetchSoldSearchRest } from "../../../src/services/listings/rest.js";

beforeEach(() => {
	fetchRetryMock.mockReset();
	fetchRetryMock.mockResolvedValue(
		new Response(JSON.stringify({ itemSummaries: [], total: 0 }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		}),
	);
});

function lastCallUrl(): URL {
	const arg0 = fetchRetryMock.mock.calls.at(-1)?.[0];
	return new URL(String(arg0));
}

describe("fetchActiveSearchRest URL composition", () => {
	it("forwards every eBay-spec query param verbatim, snake_case preserved", async () => {
		await fetchActiveSearchRest({
			q: "air jordan 4 black cat",
			limit: 25,
			offset: 50,
			filter: "buyingOptions:{FIXED_PRICE}",
			sort: "newlyListed",
			category_ids: "15709",
			aspect_filter: "categoryId:15709,Color:{Black},Size:{8}",
			gtin: "194501013215",
			epid: "29030001",
			fieldgroups: "EXTENDED",
			auto_correct: "KEYWORD",
			compatibility_filter: "Year:2010;Make:Honda;Model:Civic",
			charity_ids: "1234",
		});
		const url = lastCallUrl();
		expect(url.pathname).toBe("/buy/browse/v1/item_summary/search");
		const p = url.searchParams;
		expect(p.get("q")).toBe("air jordan 4 black cat");
		expect(p.get("filter")).toBe("buyingOptions:{FIXED_PRICE}");
		expect(p.get("sort")).toBe("newlyListed");
		expect(p.get("limit")).toBe("25");
		expect(p.get("offset")).toBe("50");
		expect(p.get("category_ids")).toBe("15709");
		expect(p.get("aspect_filter")).toBe("categoryId:15709,Color:{Black},Size:{8}");
		expect(p.get("gtin")).toBe("194501013215");
		expect(p.get("epid")).toBe("29030001");
		expect(p.get("fieldgroups")).toBe("EXTENDED");
		expect(p.get("auto_correct")).toBe("KEYWORD");
		expect(p.get("compatibility_filter")).toBe("Year:2010;Make:Honda;Model:Civic");
		expect(p.get("charity_ids")).toBe("1234");
	});

	it("omits unset optional params (URL stays clean)", async () => {
		await fetchActiveSearchRest({ q: "minimal" });
		const url = lastCallUrl();
		const keys = [...url.searchParams.keys()];
		// Only `q` should appear when nothing else is set.
		expect(keys).toEqual(["q"]);
	});
});

describe("fetchSoldSearchRest URL composition", () => {
	it("forwards Marketplace Insights' subset of eBay params", async () => {
		await fetchSoldSearchRest({
			q: "canon ef 50mm",
			limit: 100,
			offset: 25,
			filter: "conditionIds:{3000}",
			category_ids: "15230",
			aspect_filter: "categoryId:15230,Brand:{Canon}",
			gtin: "0013803131093",
			epid: "94002233",
			fieldgroups: "MATCHING_ITEMS",
		});
		const url = lastCallUrl();
		expect(url.pathname).toBe("/buy/marketplace_insights/v1_beta/item_sales/search");
		const p = url.searchParams;
		expect(p.get("q")).toBe("canon ef 50mm");
		expect(p.get("limit")).toBe("100");
		expect(p.get("offset")).toBe("25");
		expect(p.get("filter")).toBe("conditionIds:{3000}");
		expect(p.get("category_ids")).toBe("15230");
		expect(p.get("aspect_filter")).toBe("categoryId:15230,Brand:{Canon}");
		expect(p.get("gtin")).toBe("0013803131093");
		expect(p.get("epid")).toBe("94002233");
		expect(p.get("fieldgroups")).toBe("MATCHING_ITEMS");
	});

	it("offset=0 is omitted (eBay's spec — no leading zero param)", async () => {
		await fetchSoldSearchRest({ q: "test", offset: 0 });
		const url = lastCallUrl();
		expect(url.searchParams.has("offset")).toBe(false);
	});
});
