import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { ebayItemDetailExecute } from "../src/tools/ebay-item-detail.js";
import { ebaySearchExecute } from "../src/tools/ebay-search.js";
import { ebayListOrdersInput, ebayMarkShippedInput } from "../src/tools/ebay-sell-fulfillment.js";
import {
	ebayCreateInventoryItemInput,
	ebayCreateOfferInput,
	ebayPublishOfferInput,
} from "../src/tools/ebay-sell-inventory.js";
import { ebaySoldSearchExecute } from "../src/tools/ebay-sold-search.js";
import {
	ebayTaxonomyAspectsInput,
	ebayTaxonomyDefaultIdInput,
	ebayTaxonomySuggestInput,
} from "../src/tools/ebay-taxonomy.js";
import { tools } from "../src/tools/index.js";

const mockConfig: Config = {
	ebayBaseUrl: "https://api.flipagent.dev",
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
	it("registers all 18 tools", () => {
		expect(tools).toHaveLength(18);
	});

	it("covers eBay read/sell + flipagent evaluate/discover/ship", () => {
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
				// flipagent value-add (Decisions / Overnight / Operations pillars)
				"evaluate_listing",
				"evaluate_signals",
				"discover_deals",
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
	it("default-id accepts a marketplace string", () => {
		expect(Value.Check(ebayTaxonomyDefaultIdInput, { marketplaceId: "EBAY_US" })).toBe(true);
	});

	it("suggest requires both treeId + q", () => {
		expect(Value.Check(ebayTaxonomySuggestInput, { categoryTreeId: "0", q: "canon 50mm" })).toBe(true);
		expect(Value.Check(ebayTaxonomySuggestInput, { q: "canon 50mm" })).toBe(false);
	});

	it("aspects requires both treeId + categoryId", () => {
		expect(Value.Check(ebayTaxonomyAspectsInput, { categoryTreeId: "0", categoryId: "31388" })).toBe(true);
		expect(Value.Check(ebayTaxonomyAspectsInput, { categoryTreeId: "0" })).toBe(false);
	});
});

describe("sell-side tool input schemas", () => {
	const validInventoryItem = {
		sku: "SKU-CANON-50-001",
		body: {
			product: {
				title: "Canon EF 50mm f/1.8 STM Lens",
				description: "Lightly used. Includes caps.",
				aspects: { Brand: ["Canon"], "Focal Length": ["50mm"] },
				imageUrls: ["https://example.com/photo1.jpg"],
				brand: "Canon",
			},
			condition: "USED_VERY_GOOD",
			availability: { shipToLocationAvailability: { quantity: 1 } },
			packageWeightAndSize: {
				dimensions: { length: 4, width: 3, height: 3, unit: "INCH" },
				weight: { value: 1.2, unit: "POUND" },
			},
			locale: "en_US",
		},
	};

	it("createInventoryItem accepts a complete InventoryItem", () => {
		expect(Value.Check(ebayCreateInventoryItemInput, validInventoryItem)).toBe(true);
	});

	it("createInventoryItem rejects an unknown condition enum value", () => {
		const bad = {
			sku: "X",
			body: { ...validInventoryItem.body, condition: "MINTED_BY_GOD" },
		};
		expect(Value.Check(ebayCreateInventoryItemInput, bad)).toBe(false);
	});

	it("createInventoryItem rejects a weight unit eBay doesn't recognize", () => {
		const bad = {
			sku: "X",
			body: {
				...validInventoryItem.body,
				packageWeightAndSize: { weight: { value: 1, unit: "TONNE" } },
			},
		};
		expect(Value.Check(ebayCreateInventoryItemInput, bad)).toBe(false);
	});

	it("createOffer requires sku, categoryId, merchantLocationKey, pricingSummary", () => {
		expect(
			Value.Check(ebayCreateOfferInput, {
				body: {
					sku: "SKU-1",
					marketplaceId: "EBAY_US",
					format: "FIXED_PRICE",
					pricingSummary: { price: { value: "65.00", currency: "USD" } },
					categoryId: "31388",
					merchantLocationKey: "warehouse-1",
				},
			}),
		).toBe(true);

		expect(
			Value.Check(ebayCreateOfferInput, {
				body: {
					sku: "SKU-1",
					marketplaceId: "EBAY_US",
					format: "FIXED_PRICE",
					pricingSummary: { price: { value: "65.00", currency: "USD" } },
					categoryId: "31388",
					// merchantLocationKey missing
				},
			}),
		).toBe(false);
	});

	it("publishOffer needs an offerId string", () => {
		expect(Value.Check(ebayPublishOfferInput, { offerId: "offer_abc" })).toBe(true);
		expect(Value.Check(ebayPublishOfferInput, {})).toBe(false);
	});

	it("listOrders accepts numeric limit/offset", () => {
		expect(Value.Check(ebayListOrdersInput, { limit: 50, offset: 0 })).toBe(true);
		expect(Value.Check(ebayListOrdersInput, { limit: 9999 })).toBe(false);
	});

	it("markShipped requires lineItems + carrier + tracking", () => {
		expect(
			Value.Check(ebayMarkShippedInput, {
				orderId: "order_123",
				body: {
					lineItems: [{ lineItemId: "li1", quantity: 1 }],
					shippingCarrierCode: "USPS",
					trackingNumber: "94001ABCDEF",
				},
			}),
		).toBe(true);

		expect(
			Value.Check(ebayMarkShippedInput, {
				orderId: "order_123",
				body: {
					lineItems: [],
					// missing carrier + tracking
				},
			}),
		).toBe(false);
	});
});
