/**
 * Canned responses returned when FLIPAGENT_MCP_MOCK=1. Lets a user install
 * the MCP server and verify their host config without needing a flipagent
 * API key or eBay OAuth.
 */

import type { BrowseSearchResponse, ItemSummary } from "@flipagent/types/ebay/buy";

const SAMPLE: ItemSummary[] = [
	{
		itemId: "v1|MOCK01|0",
		title: "Canon EF 50mm f/1.8 STM Lens — used, with caps",
		itemWebUrl: "https://www.ebay.com/itm/MOCK01",
		condition: "Used",
		price: { value: "65.00", currency: "USD" },
		shippingOptions: [{ shippingCost: { value: "0.00", currency: "USD" } }],
		buyingOptions: ["FIXED_PRICE"],
		seller: { username: "mock_seller", feedbackScore: 1240, feedbackPercentage: "99.5" },
	},
	{
		itemId: "v1|MOCK02|0",
		title: "Canon EF 50mm f1.8 STM Auction!",
		itemWebUrl: "https://www.ebay.com/itm/MOCK02",
		condition: "Used",
		price: { value: "42.00", currency: "USD" },
		buyingOptions: ["AUCTION"],
		bidCount: 0,
		watchCount: 1,
		itemEndDate: new Date(Date.now() + 30 * 60_000).toISOString(),
		seller: { username: "mock_seller2", feedbackScore: 89, feedbackPercentage: "97.0" },
	},
];

export function mockSearch(): BrowseSearchResponse {
	return { itemSummaries: SAMPLE, total: SAMPLE.length };
}

export function mockSoldSearch(): BrowseSearchResponse {
	return { itemSales: SAMPLE, total: SAMPLE.length };
}

export function mockItemDetail(itemId: string) {
	return {
		itemId,
		title: "Canon EF 50mm f/1.8 STM Lens (mock)",
		itemWebUrl: `https://www.ebay.com/itm/${itemId.split("|")[1] ?? itemId}`,
		condition: "Used",
		price: { value: "65.00", currency: "USD" },
		buyingOptions: ["FIXED_PRICE"],
		description: "Mock description. Set FLIPAGENT_MCP_MOCK=0 for real data.",
		seller: { username: "mock_seller", feedbackScore: 1240 },
	};
}
