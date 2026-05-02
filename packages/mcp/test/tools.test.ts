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
import { tools } from "../src/tools/index.js";

const mockConfig: Config = {
	flipagentBaseUrl: "https://api.flipagent.dev",
	authToken: "fa_test",
	mock: true,
	userAgent: "flipagent-mcp/test",
};

describe("tool execute (mock mode)", () => {
	it("ebay_search returns canned SearchPagedCollection when mock=true", async () => {
		const result = (await ebaySearchExecute(mockConfig, { q: "canon" })) as { itemSummaries: unknown[] };
		expect(Array.isArray(result.itemSummaries)).toBe(true);
		expect(result.itemSummaries.length).toBeGreaterThan(0);
	});

	it("ebay_sold_search returns canned itemSales when mock=true", async () => {
		const result = (await ebaySoldSearchExecute(mockConfig, { q: "canon" })) as { itemSales: unknown[] };
		expect(Array.isArray(result.itemSales)).toBe(true);
		expect(result.itemSales.length).toBeGreaterThan(0);
	});

	it("ebay_item_detail echoes itemId in mock response", async () => {
		const result = (await ebayItemDetailExecute(mockConfig, { itemId: "v1|MOCK01|0" })) as { itemId: string };
		expect(result.itemId).toBe("v1|MOCK01|0");
	});
});

describe("tools registry", () => {
	it("registers all 29 tools", () => {
		expect(tools).toHaveLength(29);
	});

	it("covers eBay read/sell + flipagent evaluate/ship", () => {
		const names = tools.map((t) => t.name);
		expect(names).toEqual(
			expect.arrayContaining([
				// eBay read
				"ebay_search",
				"ebay_item_detail",
				"ebay_sold_search",
				"ebay_taxonomy_default_id",
				"ebay_taxonomy_suggest",
				"ebay_taxonomy_aspects",
				// flipagent management
				"flipagent_connect_status",
				// eBay sell
				"ebay_create_inventory_item",
				"ebay_create_offer",
				"ebay_publish_offer",
				"ebay_list_orders",
				"ebay_mark_shipped",
				"ebay_list_payouts",
				// flipagent value-add (Decisions / Operations pillars)
				"evaluate_listing",
				"ship_quote",
				"ship_providers",
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

describe("taxonomy tool input schemas", () => {
	it("default-id accepts an optional marketplace string", () => {
		expect(Value.Check(ebayTaxonomyDefaultIdInput, { marketplace: "ebay" })).toBe(true);
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
