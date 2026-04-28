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

const STUB_VERDICT = {
	isDeal: true,
	netCents: 1840,
	confidence: 0.82,
	landedCostCents: 4280,
	signals: [{ name: "under_median", weight: 1, reason: "stubbed" }],
	rating: "buy" as const,
	reason: "stubbed",
};

const STUB_ITEM = {
	itemId: "v1|123|0",
	title: "test",
	itemWebUrl: "https://www.ebay.com/itm/123",
	price: { value: "60.00", currency: "USD" },
};

describe("createFlipagentClient", () => {
	it("listings.search hits /v1/listings/search with bearer auth", async () => {
		const { calls, fetch } = fakeFetchOk({ itemSummaries: [STUB_ITEM], total: 1 });
		const client = createFlipagentClient({ apiKey: "fk_test", fetch });

		const res = await client.listings.search({ q: "canon 50mm" });

		expect(res.itemSummaries).toHaveLength(1);
		expect(calls).toHaveLength(1);
		const url = new URL(calls[0].url);
		expect(url.pathname).toBe("/v1/listings/search");
		expect(url.searchParams.get("q")).toBe("canon 50mm");
		expect(calls[0].init.method).toBe("GET");
		expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer fk_test");
	});

	it("listings.get hits /v1/listings/{itemId}", async () => {
		const { calls, fetch } = fakeFetchOk({ itemId: "v1|123|0", title: "test" });
		const client = createFlipagentClient({ apiKey: "fk_test", fetch });

		await client.listings.get("v1|123|0");

		expect(new URL(calls[0].url).pathname).toBe("/v1/listings/v1%7C123%7C0");
	});

	it("sold.search hits /v1/sold/search", async () => {
		const { calls, fetch } = fakeFetchOk({ itemSales: [], total: 0 });
		const client = createFlipagentClient({ apiKey: "fk_test", fetch });

		await client.sold.search({ q: "canon" });

		expect(new URL(calls[0].url).pathname).toBe("/v1/sold/search");
	});

	it("evaluate.listing posts /v1/evaluate", async () => {
		const { calls, fetch } = fakeFetchOk(STUB_VERDICT);
		const client = createFlipagentClient({ apiKey: "fk_test", fetch });

		const verdict = await client.evaluate.listing({ item: STUB_ITEM });

		expect(verdict).toEqual(STUB_VERDICT);
		expect(new URL(calls[0].url).pathname).toBe("/v1/evaluate");
		expect(calls[0].init.method).toBe("POST");
		expect((calls[0].init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
	});

	it("evaluate.signals posts /v1/evaluate/signals", async () => {
		const { calls, fetch } = fakeFetchOk({ signals: [] });
		const client = createFlipagentClient({ apiKey: "fk_test", fetch });

		await client.evaluate.signals({ item: STUB_ITEM, comps: [] });

		expect(new URL(calls[0].url).pathname).toBe("/v1/evaluate/signals");
	});

	it("discover.deals posts /v1/discover", async () => {
		const { calls, fetch } = fakeFetchOk({ deals: [{ itemId: "v1|123|0", verdict: STUB_VERDICT }] });
		const client = createFlipagentClient({ apiKey: "fk_test", fetch });

		const res = await client.discover.deals({ results: { itemSummaries: [STUB_ITEM] } });

		expect(res.deals).toHaveLength(1);
		expect(new URL(calls[0].url).pathname).toBe("/v1/discover");
	});

	it("ship.quote posts /v1/ship/quote", async () => {
		const breakdown = {
			itemPriceCents: 6000,
			shippingCents: 500,
			forwarderCents: 1200,
			taxCents: 0,
			totalCents: 7700,
			forwarderProviderId: "planet-express",
			forwarderEtaDays: [3, 4],
			forwarderCaveats: [],
		};
		const { calls, fetch } = fakeFetchOk(breakdown);
		const client = createFlipagentClient({ apiKey: "fk_test", fetch });

		await client.ship.quote({
			item: STUB_ITEM,
			forwarder: { destState: "NY", weightG: 500 },
		});

		expect(new URL(calls[0].url).pathname).toBe("/v1/ship/quote");
	});

	it("ship.providers fetches /v1/ship/providers", async () => {
		const { calls, fetch } = fakeFetchOk({ providers: [{ id: "planet-express", name: "Planet Express" }] });
		const client = createFlipagentClient({ apiKey: "fk_test", fetch });

		const res = await client.ship.providers();

		expect(res.providers[0]?.id).toBe("planet-express");
		expect(new URL(calls[0].url).pathname).toBe("/v1/ship/providers");
		expect(calls[0].init.method).toBe("GET");
	});

	it("respects a custom baseUrl + strips trailing slash", async () => {
		const { calls, fetch } = fakeFetchOk({ itemSummaries: [], total: 0 });
		const client = createFlipagentClient({ apiKey: "fk_dev", baseUrl: "http://localhost:4000//", fetch });

		await client.listings.search({ q: "x" });

		expect(new URL(calls[0].url).origin).toBe("http://localhost:4000");
		expect(new URL(calls[0].url).pathname).toBe("/v1/listings/search");
	});

	it("throws FlipagentApiError on non-2xx with upstream payload", async () => {
		const fetch: typeof globalThis.fetch = async () =>
			new Response(JSON.stringify({ error: "rate_limited", message: "no" }), {
				status: 429,
				headers: { "Content-Type": "application/json" },
			});
		const client = createFlipagentClient({ apiKey: "fk_test", fetch });

		await expect(client.evaluate.listing({ item: STUB_ITEM })).rejects.toMatchObject({
			name: "FlipagentApiError",
			status: 429,
			detail: { error: "rate_limited", message: "no" },
		});
	});

	it("FlipagentApiError exposes status + path + detail", () => {
		const err = new FlipagentApiError(503, "/v1/evaluate", { error: "billing_not_configured" });
		expect(err).toBeInstanceOf(Error);
		expect(err.status).toBe(503);
		expect(err.path).toBe("/v1/evaluate");
		expect(err.detail).toEqual({ error: "billing_not_configured" });
	});
});
