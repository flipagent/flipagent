import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { ebayItemDetailExecute } from "../src/tools/ebay-item-detail.js";
import {
	ebayCreateInventoryItemInput,
	ebayCreateOfferInput,
	ebayPublishOfferInput,
} from "../src/tools/ebay-listings.js";
import { ebayListOrdersInput, ebayMarkShippedInput } from "../src/tools/ebay-sales.js";
import { ebaySearchExecute } from "../src/tools/ebay-search.js";
import { ebaySoldSearchExecute } from "../src/tools/ebay-sold-search.js";
import {
	ebayTaxonomyAspectsInput,
	ebayTaxonomyDefaultIdInput,
	ebayTaxonomySuggestInput,
} from "../src/tools/ebay-taxonomy.js";
import { selectTools, tools } from "../src/tools/index.js";

const mockConfig: Config = {
	flipagentBaseUrl: "https://api.flipagent.dev",
	authToken: "fa_test",
	mock: true,
	userAgent: "flipagent-mcp/test",
	enabledToolsets: ["*"],
};

describe("tool execute (mock mode)", () => {
	it("flipagent_search_items returns canned SearchPagedCollection when mock=true", async () => {
		const result = (await ebaySearchExecute(mockConfig, { q: "canon" })) as { itemSummaries: unknown[] };
		expect(Array.isArray(result.itemSummaries)).toBe(true);
		expect(result.itemSummaries.length).toBeGreaterThan(0);
	});

	it("flipagent_search_sold_items returns canned itemSales when mock=true", async () => {
		const result = (await ebaySoldSearchExecute(mockConfig, { q: "canon" })) as { itemSales: unknown[] };
		expect(Array.isArray(result.itemSales)).toBe(true);
		expect(result.itemSales.length).toBeGreaterThan(0);
	});

	it("flipagent_get_item echoes itemId in mock response", async () => {
		const result = (await ebayItemDetailExecute(mockConfig, { itemId: "v1|MOCK01|0" })) as { itemId: string };
		expect(result.itemId).toBe("v1|MOCK01|0");
	});
});

describe("tools registry", () => {
	it("registers the Phase 1 tool set", () => {
		// Phase 1 — hands-off reseller cycle: source/buy/receive/list/sell/comms/resolve/analyze.
		// Adjust this number whenever a Phase 1 tool is added or removed.
		expect(tools.length).toBeGreaterThan(80);
		expect(tools.length).toBeLessThan(110);
	});

	it("uses the flipagent_<verb>_<resource> naming scheme uniformly", () => {
		for (const t of tools) {
			expect(t.name).toMatch(/^flipagent_/);
			expect(t.name).toMatch(/^[a-z0-9_]+$/);
		}
	});

	it("tags every tool with a known toolset", () => {
		const valid = new Set(["core", "comms", "forwarder", "notifications", "seller_account", "admin"]);
		for (const t of tools) {
			expect(valid.has(t.toolset)).toBe(true);
		}
	});

	it("covers the canonical search → evaluate → buy → list → sale → fulfill flow", () => {
		const names = tools.map((t) => t.name);
		expect(names).toEqual(
			expect.arrayContaining([
				// core discovery
				"flipagent_get_capabilities",
				"flipagent_get_my_key",
				// sourcing
				"flipagent_search_items",
				"flipagent_get_item",
				"flipagent_search_sold_items",
				"flipagent_list_categories",
				"flipagent_suggest_category",
				"flipagent_list_category_aspects",
				// decisions + operations
				"flipagent_evaluate_item",
				"flipagent_get_evaluate_job",
				"flipagent_get_evaluation_pool",
				"flipagent_quote_shipping",
				// buy
				"flipagent_create_purchase",
				"flipagent_get_purchase",
				"flipagent_cancel_purchase",
				// list
				"flipagent_create_listing",
				"flipagent_update_listing",
				"flipagent_relist_listing",
				// sale fulfillment
				"flipagent_list_sales",
				"flipagent_ship_sale",
				"flipagent_list_payouts",
			]),
		);
	});

	it("each tool has a non-empty description and an object inputSchema", () => {
		for (const t of tools) {
			expect(t.description.length).toBeGreaterThan(0);
			expect(t.inputSchema).toHaveProperty("type", "object");
		}
	});
});

describe("toolset gating", () => {
	it("default core selection includes the canonical first-call tools", () => {
		const defaults = selectTools(["core"]);
		expect(defaults.length).toBeGreaterThan(0);
		const names = defaults.map((t) => t.name);
		expect(names).toContain("flipagent_get_capabilities");
		expect(names).toContain("flipagent_evaluate_item");
		expect(names).toContain("flipagent_create_listing");
	});

	it('"*" selects every registered tool', () => {
		const all = selectTools(["*"]);
		expect(all).toHaveLength(tools.length);
	});

	it("single toolset filters to just that group", () => {
		const onlyComms = selectTools(["comms"]);
		for (const t of onlyComms) expect(t.toolset).toBe("comms");
	});
});

describe("taxonomy tool input schemas", () => {
	it("default-id accepts an optional marketplace string", () => {
		expect(Value.Check(ebayTaxonomyDefaultIdInput, { marketplace: "ebay_us" })).toBe(true);
		expect(Value.Check(ebayTaxonomyDefaultIdInput, {})).toBe(true);
	});

	it("suggest requires a free-text title", () => {
		expect(Value.Check(ebayTaxonomySuggestInput, { title: "canon 50mm" })).toBe(true);
		expect(Value.Check(ebayTaxonomySuggestInput, {})).toBe(false);
	});

	it("aspects requires a categoryId", () => {
		expect(Value.Check(ebayTaxonomyAspectsInput, { categoryId: "31388" })).toBe(true);
		expect(Value.Check(ebayTaxonomyAspectsInput, {})).toBe(false);
	});
});

describe("sell-side tool input schemas", () => {
	const validListingCreate = {
		title: "Canon EF 50mm f/1.8 STM Lens",
		description: "Lightly used. Includes caps.",
		price: { value: 6500, currency: "USD" },
		condition: "used_very_good",
		categoryId: "31388",
		images: ["https://example.com/photo1.jpg"],
		aspects: { Brand: ["Canon"], "Focal Length": ["50mm"] },
	};

	it("createInventoryItem (= POST /v1/listings) accepts a flipagent-native ListingCreate", () => {
		expect(Value.Check(ebayCreateInventoryItemInput, validListingCreate)).toBe(true);
	});

	it("createInventoryItem rejects an unknown condition enum value", () => {
		const bad = { ...validListingCreate, condition: "MINTED_BY_GOD" };
		expect(Value.Check(ebayCreateInventoryItemInput, bad)).toBe(false);
	});

	it("createInventoryItem rejects when images is empty", () => {
		const bad = { ...validListingCreate, images: [] };
		expect(Value.Check(ebayCreateInventoryItemInput, bad)).toBe(false);
	});

	it("createOffer (= PATCH /v1/listings/{sku}) accepts sku + patch fields", () => {
		expect(
			Value.Check(ebayCreateOfferInput, {
				sku: "SKU-1",
				price: { value: 6500, currency: "USD" },
				quantity: 2,
			}),
		).toBe(true);

		// Missing sku → invalid
		expect(
			Value.Check(ebayCreateOfferInput, {
				price: { value: 6500, currency: "USD" },
			}),
		).toBe(false);
	});

	it("publishOffer (= POST /v1/listings/{sku}/relist) needs a sku string", () => {
		expect(Value.Check(ebayPublishOfferInput, { sku: "SKU-1" })).toBe(true);
		expect(Value.Check(ebayPublishOfferInput, {})).toBe(false);
	});

	it("listOrders accepts numeric limit/offset", () => {
		expect(Value.Check(ebayListOrdersInput, { limit: 50, offset: 0 })).toBe(true);
		expect(Value.Check(ebayListOrdersInput, { limit: 9999 })).toBe(false);
	});

	it("markShipped requires trackingNumber + carrier", () => {
		expect(
			Value.Check(ebayMarkShippedInput, {
				orderId: "order_123",
				trackingNumber: "94001ABCDEF",
				carrier: "USPS",
			}),
		).toBe(true);

		expect(
			Value.Check(ebayMarkShippedInput, {
				orderId: "order_123",
				// missing carrier + tracking
			}),
		).toBe(false);
	});
});
