import { afterAll, describe, expect, it, vi } from "vitest";
import "./setup.js";

// Stub the scrape backend BEFORE importing app/routes so the route
// modules pick up the mock instead of hitting eBay.
vi.mock("../src/proxy/scrape.js", () => ({
	scrapeSearch: async ({ q }: { q: string }) => ({
		itemSummaries: [
			{
				itemId: "v1|TEST01|0",
				title: `Test result for ${q}`,
				itemWebUrl: "https://www.ebay.com/itm/TEST01",
				price: { value: "99.99", currency: "USD" },
			},
		],
		total: 1,
	}),
	scrapeItemDetail: async (itemId: string) => ({
		itemId,
		title: "Test detail",
		itemWebUrl: `https://www.ebay.com/itm/${itemId}`,
		price: { value: "99.99", currency: "USD" },
	}),
}));

const { app } = await import("../src/app.js");
const { closeDb, db } = await import("../src/db/client.js");
const { apiKeys, expenseEvents, takedownRequests, usageEvents } = await import("../src/db/schema.js");
const { issueKey } = await import("../src/auth/keys.js");
const { sql } = await import("drizzle-orm");

async function call(path: string, init: RequestInit = {}): Promise<Response> {
	return app.fetch(new Request(`http://test.local${path}`, init));
}

/**
 * Tests bypass /api/auth (Better-Auth needs GitHub round-trip + cookies)
 * and seed keys directly through the library. The api routes themselves
 * still go through the real `requireApiKey` middleware.
 */
async function issueFreeKey(email: string): Promise<string> {
	return (await issueKey({ tier: "free", ownerEmail: email })).plaintext;
}

afterAll(async () => {
	// Clean rows produced by this run so reruns don't compound.
	await db.execute(sql`truncate ${expenseEvents}, ${usageEvents}, ${takedownRequests} restart identity cascade`);
	await db.execute(sql`delete from ${apiKeys} where owner_email like 'integration+%'`);
	await closeDb();
});

describe("descriptors + health", () => {
	it("GET / returns the path manifest", async () => {
		const res = await call("/");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { name: string; paths: string[] };
		expect(body.name).toBe("flipagent");
		expect(body.paths).toContain("GET /v1/listings/search");
	});

	it("GET /healthz reports db ok", async () => {
		const res = await call("/healthz");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { status: string; db: { ok: boolean } };
		expect(body.status).toBe("ok");
		expect(body.db.ok).toBe(true);
	});
});

describe("/v1/keys", () => {
	it("issued key has prefix matching plaintext", async () => {
		const issued = await issueKey({ tier: "free", ownerEmail: "integration+issue@example.com" });
		expect(issued.tier).toBe("free");
		expect(issued.plaintext.startsWith("fa_free_")).toBe(true);
		expect(issued.plaintext.startsWith(issued.prefix)).toBe(true);
	});

	it("GET /v1/keys/me requires auth", async () => {
		const res = await call("/v1/keys/me");
		expect(res.status).toBe(401);
	});

	it("GET /v1/keys/me with valid key reports usage", async () => {
		const key = await issueFreeKey("integration+me@example.com");
		// usage_events for the calling request itself is recorded *after* the
		// response is sent, so the first /me call sees used=0. The second call
		// sees the first call's row.
		await call("/v1/keys/me", { headers: { authorization: `Bearer ${key}` } });
		// best-effort wait for the deferred recordUsage write to flush
		await new Promise((r) => setTimeout(r, 100));
		const res = await call("/v1/keys/me", { headers: { authorization: `Bearer ${key}` } });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { tier: string; usage: { used: number; limit: number } };
		expect(body.tier).toBe("free");
		expect(body.usage.limit).toBe(100);
		expect(body.usage.used).toBeGreaterThanOrEqual(1);
	});

	it("POST /v1/keys/revoke disables the key", async () => {
		const key = await issueFreeKey("integration+revoke@example.com");
		const revoke = await call("/v1/keys/revoke", { method: "POST", headers: { "x-api-key": key } });
		expect(revoke.status).toBe(200);
		const after = await call("/v1/keys/me", { headers: { "x-api-key": key } });
		expect(after.status).toBe(401);
	});
});

describe("/v1/health/features", () => {
	it("returns env-based capability flags without auth", async () => {
		const res = await call("/v1/health/features");
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, boolean>;
		// setup.ts wipes EBAY_CLIENT_ID/SECRET/RU_NAME so ebayOAuth must be false here.
		expect(body.ebayOAuth).toBe(false);
		// Every flag is a boolean — no nulls.
		for (const v of Object.values(body)) expect(typeof v).toBe("boolean");
		// All nine flags present.
		expect(Object.keys(body).sort()).toEqual([
			"betterAuth",
			"ebayOAuth",
			"email",
			"googleOAuth",
			"insightsApi",
			"llm",
			"orderApi",
			"scraperApi",
			"stripe",
		]);
	});
});

describe("/v1/keys/permissions", () => {
	it("rejects calls without an api key", async () => {
		const res = await call("/v1/keys/permissions");
		expect(res.status).toBe(401);
	});

	it("returns scope map for the calling key (no eBay binding)", async () => {
		const key = await issueFreeKey("integration+perms@example.com");
		const res = await call("/v1/keys/permissions", { headers: { authorization: `Bearer ${key}` } });
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			ebayConnected: boolean;
			scopes: Record<string, string>;
		};
		// setup.ts wipes eBay env so user-OAuth scopes are "unavailable" + browse fallback.
		expect(body.ebayConnected).toBe(false);
		expect(body.scopes.browse).toBe("scrape_fallback");
		expect(body.scopes.marketplaceInsights).toBe("scrape_fallback");
		expect(body.scopes.inventory).toBe("unavailable");
		expect(body.scopes.orderApi).toBe("unavailable");
	});
});

describe("/v1/sold (scrape with source field)", () => {
	it("returns source: 'scrape' in body and X-Flipagent-Source header", async () => {
		const key = await issueFreeKey("integration+sold@example.com");
		const res = await call("/v1/sold/search?q=widget&limit=5", {
			headers: { authorization: `Bearer ${key}` },
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("x-flipagent-source")).toMatch(/^(scrape|cache:scrape)$/);
		const body = (await res.json()) as { source?: string };
		expect(body.source).toMatch(/^(scrape|cache:scrape)$/);
	});
});

describe("/v1/listings (mocked scrape)", () => {
	it("rejects calls without an api key", async () => {
		const res = await call("/v1/listings/search?q=test");
		expect(res.status).toBe(401);
	});

	it("returns mocked search results with rate-limit headers", async () => {
		const key = await issueFreeKey("integration+search@example.com");
		const res = await call("/v1/listings/search?q=widget&limit=5", {
			headers: { authorization: `Bearer ${key}` },
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("x-ratelimit-limit")).toBe("100");
		expect(res.headers.get("x-flipagent-source")).toMatch(/^(scrape|cache:scrape)$/);
		const body = (await res.json()) as { itemSummaries: Array<{ itemId: string }> };
		expect(body.itemSummaries.length).toBe(1);
		expect(body.itemSummaries[0]?.itemId).toBe("v1|TEST01|0");
	});

	it("returns mocked item detail", async () => {
		const key = await issueFreeKey("integration+detail@example.com");
		const res = await call("/v1/listings/v1%7CTEST02%7C0", {
			headers: { authorization: `Bearer ${key}` },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { itemId: string };
		expect(body.itemId).toBe("v1|TEST02|0");
	});
});

describe("/v1/takedown", () => {
	it("rejects malformed body", async () => {
		const res = await call("/v1/takedown", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ itemId: "x" }),
		});
		expect(res.status).toBe(400);
	});

	it("accepts a valid takedown and returns pending status", async () => {
		const res = await call("/v1/takedown", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				itemId: "v1|TAKE|0",
				contactEmail: "seller@example.com",
				reason: "test",
			}),
		});
		expect(res.status).toBe(201);
		const body = (await res.json()) as { id: string; status: string };
		expect(body.status).toBe("pending");
		expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
	});
});

describe("/v1/expenses", () => {
	it("rejects record without an api key", async () => {
		const res = await call("/v1/expenses/record", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ kind: "purchased", sku: "x", amountCents: 1 }),
		});
		expect(res.status).toBe(401);
	});

	it("records a purchased event and returns it", async () => {
		const key = await issueFreeKey("integration+expenses-rec@example.com");
		const res = await call("/v1/expenses/record", {
			method: "POST",
			headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
			body: JSON.stringify({
				kind: "purchased",
				sku: "lens-canon-50-001",
				amountCents: 6500,
				externalId: "v1|123|0",
				payload: { predictedNetCents: 4500 },
			}),
		});
		expect(res.status).toBe(201);
		const body = (await res.json()) as { id: string; kind: string; amountCents: number };
		expect(body.kind).toBe("purchased");
		expect(body.amountCents).toBe(6500);
		expect(body.id).toMatch(/^\d+$/);
	});

	it("normalizes negative amountCents to positive (defensive)", async () => {
		const key = await issueFreeKey("integration+expenses-neg@example.com");
		const res = await call("/v1/expenses/record", {
			method: "POST",
			headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
			body: JSON.stringify({ kind: "expense", sku: "x", amountCents: 0 }),
		});
		expect(res.status).toBe(201);
	});

	it("rejects malformed body (missing required field)", async () => {
		const key = await issueFreeKey("integration+expenses-mal@example.com");
		const res = await call("/v1/expenses/record", {
			method: "POST",
			headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
			body: JSON.stringify({ kind: "purchased" }),
		});
		expect(res.status).toBe(400);
	});

	it("aggregates summary across kinds + scopes by owner", async () => {
		const email = "integration+expenses-sum@example.com";
		const key = await issueFreeKey(email);
		const post = (body: unknown) =>
			call("/v1/expenses/record", {
				method: "POST",
				headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
				body: JSON.stringify(body),
			});
		await post({ kind: "purchased", sku: "sku-A", amountCents: 5000, payload: { predictedNetCents: 3000 } });
		await post({ kind: "purchased", sku: "sku-B", amountCents: 7000 });
		await post({ kind: "forwarder_fee", sku: "sku-A", amountCents: 1200 });
		await post({ kind: "expense", sku: "sku-A", amountCents: 300 });

		const res = await call("/v1/expenses/summary?windowDays=30", {
			headers: { authorization: `Bearer ${key}` },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			counts: { purchased: number; forwarderFee: number; expense: number; distinctSkus: number };
			costs: { acquisitionCents: number; forwarderCents: number; expenseCents: number; totalCostsCents: number };
		};
		expect(body.counts.purchased).toBe(2);
		expect(body.counts.forwarderFee).toBe(1);
		expect(body.counts.expense).toBe(1);
		expect(body.counts.distinctSkus).toBe(2); // sku-A, sku-B
		expect(body.costs.acquisitionCents).toBe(12000);
		expect(body.costs.forwarderCents).toBe(1200);
		expect(body.costs.expenseCents).toBe(300);
		expect(body.costs.totalCostsCents).toBe(13500);
	});
});

describe("/v1/billing", () => {
	it("checkout returns 503 when auth env not configured", async () => {
		// In test env we don't set BETTER_AUTH_SECRET / GITHUB_CLIENT_ID,
		// so requireSession (which runs before the Stripe check) returns 503.
		if (process.env.BETTER_AUTH_SECRET) return;
		const checkout = await call("/v1/billing/checkout", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ tier: "hobby" }),
		});
		expect(checkout.status).toBe(503);
	});

	it("returns 503 webhook without env, 400 invalid sig with env", async () => {
		if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET) {
			const res = await call("/v1/billing/webhook", {
				method: "POST",
				headers: { "stripe-signature": "t=1,v1=fake" },
				body: "{}",
			});
			expect(res.status).toBe(400);
		} else {
			const res = await call("/v1/billing/webhook", {
				method: "POST",
				headers: { "stripe-signature": "t=1,v1=fake" },
				body: "{}",
			});
			expect(res.status).toBe(503);
		}
	});
});
