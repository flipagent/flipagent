import { describe, expect, it } from "vitest";
import { createFlipagentClient, FlipagentApiError } from "../src/index.js";

type Captured = { url: string; init: RequestInit };

function fakeFetchOk(body: unknown): { calls: Captured[]; fetch: typeof globalThis.fetch } {
	const calls: Captured[] = [];
	const fetch: typeof globalThis.fetch = async (url, init = {}) => {
		calls.push({ url: url.toString(), init });
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};
	return { calls, fetch };
}

const STUB_EVALUATION = {
	netCents: 1840,
	confidence: 0.82,
	landedCostCents: 4280,
	signals: [{ name: "under_median", weight: 1, reason: "stubbed" }],
	rating: "buy" as const,
	reason: "stubbed",
};

const STUB_META = {
	itemSource: "scrape" as const,
	compsQuery: "test query",
	compsCount: 12,
	compsSource: "scrape" as const,
};

const STUB_ITEM = {
	id: "123",
	marketplace: "ebay" as const,
	status: "active" as const,
	title: "test",
	url: "https://www.ebay.com/itm/123",
	images: [],
};

describe("createFlipagentClient", () => {
	it("items.search hits /v1/items/search with bearer auth", async () => {
		const { calls, fetch } = fakeFetchOk({ items: [STUB_ITEM], limit: 50, offset: 0 });
		const client = createFlipagentClient({ apiKey: "fk_test", fetch });

		const res = await client.items.search({ q: "canon 50mm" });

		expect(res.items).toHaveLength(1);
		expect(calls).toHaveLength(1);
		const url = new URL(calls[0]!.url);
		expect(url.pathname).toBe("/v1/items/search");
		expect(url.searchParams.get("q")).toBe("canon 50mm");
		expect(calls[0]!.init.method).toBe("GET");
		expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer fk_test");
	});

	it("items.get hits /v1/items/{id}", async () => {
		const { calls, fetch } = fakeFetchOk(STUB_ITEM);
		const client = createFlipagentClient({ apiKey: "fk_test", fetch });

		await client.items.get("123");

		expect(new URL(calls[0]!.url).pathname).toBe("/v1/items/123");
	});

	it("items.search?status=sold flips to sold mode", async () => {
		const { calls, fetch } = fakeFetchOk({ items: [STUB_ITEM], limit: 50, offset: 0 });
		const client = createFlipagentClient({ apiKey: "fk_test", fetch });

		await client.items.search({ q: "x", status: "sold" });

		expect(new URL(calls[0]!.url).searchParams.get("status")).toBe("sold");
	});

	it("listings.create POSTs /v1/listings", async () => {
		const { calls, fetch } = fakeFetchOk({ id: "L1", sku: "S1", status: "active" });
		const client = createFlipagentClient({ apiKey: "fk_test", fetch });

		await client.listings.create({
			title: "x",
			price: { value: 1000, currency: "USD" },
			condition: "new",
			categoryId: "1",
			images: ["https://img/1.jpg"],
			policies: { fulfillmentPolicyId: "F", paymentPolicyId: "P", returnPolicyId: "R" },
			merchantLocationKey: "wh-1",
		});

		expect(calls[0]!.init.method).toBe("POST");
		expect(new URL(calls[0]!.url).pathname).toBe("/v1/listings");
	});

	it("listings.update sends PATCH", async () => {
		const { calls, fetch } = fakeFetchOk({ id: "L1", sku: "S1", status: "active" });
		const client = createFlipagentClient({ apiKey: "fk_test", fetch });

		await client.listings.update("S1", { price: { value: 2000, currency: "USD" } });

		expect(calls[0]!.init.method).toBe("PATCH");
		expect(new URL(calls[0]!.url).pathname).toBe("/v1/listings/S1");
	});

	it("purchases.create POSTs /v1/purchases", async () => {
		const { calls, fetch } = fakeFetchOk({ id: "PO-1", status: "queued" });
		const client = createFlipagentClient({ apiKey: "fk_test", fetch });

		await client.purchases.create({ items: [{ itemId: "123" }] });

		expect(calls[0]!.init.method).toBe("POST");
		expect(new URL(calls[0]!.url).pathname).toBe("/v1/purchases");
	});

	it("sales.ship POSTs /v1/sales/{id}/ship", async () => {
		const { calls, fetch } = fakeFetchOk({ id: "27-1", status: "shipped" });
		const client = createFlipagentClient({ apiKey: "fk_test", fetch });

		await client.sales.ship("27-1", { trackingNumber: "1Z", carrier: "UPS" });

		expect(new URL(calls[0]!.url).pathname).toBe("/v1/sales/27-1/ship");
	});

	it("disputes.respond POSTs /v1/disputes/{id}/respond", async () => {
		const { calls, fetch } = fakeFetchOk({ id: "R-1", status: "resolved" });
		const client = createFlipagentClient({ apiKey: "fk_test", fetch });

		await client.disputes.respond("R-1", { action: "accept" });

		expect(new URL(calls[0]!.url).pathname).toBe("/v1/disputes/R-1/respond");
	});

	it("evaluate.listing POSTs /v1/evaluate", async () => {
		const { calls, fetch } = fakeFetchOk({
			item: { itemId: "v1|9|0", title: "x", itemWebUrl: "https://", price: { value: "10.00", currency: "USD" } },
			...STUB_EVALUATION,
			meta: STUB_META,
		});
		const client = createFlipagentClient({ apiKey: "fk_test", fetch });

		await client.evaluate.listing({ itemId: "v1|9|0" });

		expect(calls[0]!.init.method).toBe("POST");
		expect(new URL(calls[0]!.url).pathname).toBe("/v1/evaluate");
	});

	it("respects a custom baseUrl + strips trailing slash", async () => {
		const { calls, fetch } = fakeFetchOk({ items: [], limit: 50, offset: 0 });
		const client = createFlipagentClient({ apiKey: "fk_dev", baseUrl: "http://localhost:4000//", fetch });

		await client.items.search({ q: "x" });

		expect(new URL(calls[0]!.url).origin).toBe("http://localhost:4000");
		expect(new URL(calls[0]!.url).pathname).toBe("/v1/items/search");
	});

	it("throws FlipagentApiError on non-2xx with upstream payload", async () => {
		const fetch: typeof globalThis.fetch = async () =>
			new Response(JSON.stringify({ error: "credits_exceeded", message: "no" }), {
				status: 429,
				headers: { "Content-Type": "application/json" },
			});
		const client = createFlipagentClient({ apiKey: "fk_test", fetch });

		await expect(client.items.search({ q: "x" })).rejects.toBeInstanceOf(FlipagentApiError);
	});
});
