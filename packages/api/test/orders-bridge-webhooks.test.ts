/**
 * Integration tests for the bridge-client (Chrome extension) surface:
 *   /v1/buy/order/* — eBay Buy Order API mirror; bridge mode when
 *                    EBAY_ORDER_API_APPROVED=0 (default in tests)
 *   /v1/bridge/*    — bridge client issues token + longpolls + reports
 *   /v1/webhooks/*  — caller registers + lists + revokes; signed delivery
 *
 * All against a real Postgres (same setup as routes.test.ts). The webhook
 * delivery is exercised by injecting a stub fetch into the dispatcher; we
 * assert both the signature and the persisted delivery row.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import "./setup.js";

const { app } = await import("../src/app.js");
const { closeDb, db } = await import("../src/db/client.js");
const { apiKeys, bridgeTokens, purchaseOrders, usageEvents, webhookDeliveries, webhookEndpoints } = await import(
	"../src/db/schema.js"
);
const { issueKey } = await import("../src/auth/keys.js");
const { dispatchOrderEvent, signPayload, verifySignature } = await import("../src/services/webhooks/dispatch.js");
const { sql, eq } = await import("drizzle-orm");

async function call(path: string, init: RequestInit = {}): Promise<Response> {
	return app.fetch(new Request(`http://test.local${path}`, init));
}

async function freshKey(email: string): Promise<{ key: string; keyId: string }> {
	const issued = await issueKey({ tier: "free", ownerEmail: email });
	return { key: issued.plaintext, keyId: issued.id };
}

async function readJson<T>(res: Response): Promise<T> {
	return (await res.json()) as T;
}

beforeAll(async () => {
	// Some prior test suites leave bare api_keys around. Make sure the
	// orphans don't poison foreign-key paths used here.
	await db.execute(
		sql`truncate ${webhookDeliveries}, ${webhookEndpoints}, ${bridgeTokens}, ${purchaseOrders} restart identity cascade`,
	);
});

afterAll(async () => {
	await db.execute(
		sql`truncate ${webhookDeliveries}, ${webhookEndpoints}, ${bridgeTokens}, ${purchaseOrders}, ${usageEvents} restart identity cascade`,
	);
	await db.execute(sql`delete from ${apiKeys} where owner_email like 'integration-bridge+%'`);
	await closeDb();
});

describe("/v1/buy/order + /v1/bridge — happy path", () => {
	/** Helper: 2-step initiate + place_order, returns the eBay PurchaseOrder. */
	async function quickCheckout(key: string, itemId: string, quantity = 1) {
		const initRes = await call("/v1/buy/order/checkout_session/initiate", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
			body: JSON.stringify({ lineItems: [{ itemId, quantity }] }),
		});
		expect(initRes.status).toBe(200);
		const session = await readJson<{ checkoutSessionId: string }>(initRes);
		const placeRes = await call(`/v1/buy/order/checkout_session/${session.checkoutSessionId}/place_order`, {
			method: "POST",
			headers: { Authorization: `Bearer ${key}` },
		});
		expect(placeRes.status).toBe(200);
		return readJson<{ purchaseOrderId: string; purchaseOrderStatus: string }>(placeRes);
	}

	it("initiate → place_order → bridge claim → result(completed) flips status to PROCESSED with receipt fields", async () => {
		const { key } = await freshKey("integration-bridge+happy@example.com");

		// 1. Issue a bridge token for the extension/bridge client.
		const tokRes = await call("/v1/bridge/tokens", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
			body: JSON.stringify({ deviceName: "test-machine" }),
		});
		expect(tokRes.status).toBe(201);
		const tok = await readJson<{ token: string; id: string; prefix: string }>(tokRes);
		expect(tok.token.startsWith("fbt_")).toBe(true);

		// 2. Caller initiates + places an order (quickCheckout = 2-step in 1 helper).
		const queued = await quickCheckout(key, "v1|ITEM01|0");
		expect(queued.purchaseOrderStatus).toBe("QUEUED_FOR_PROCESSING");

		// 3. Daemon longpolls and immediately picks it up.
		const pollRes = await call("/v1/bridge/poll", {
			headers: { Authorization: `Bearer ${tok.token}` },
		});
		expect(pollRes.status).toBe(200);
		const job = await readJson<{ jobId: string; task: string; args: { itemId: string } }>(pollRes);
		expect(job.jobId).toBe(queued.purchaseOrderId);
		expect(job.task).toBe("ebay_buy_item");
		expect(job.args.itemId).toBe("v1|ITEM01|0");

		// 4. Status reflects the claim (QUEUED_FOR_PROCESSING covers both internal queued + claimed).
		const claimedRes = await call(`/v1/buy/order/purchase_order/${queued.purchaseOrderId}`, {
			headers: { Authorization: `Bearer ${key}` },
		});
		const claimed = await readJson<{ purchaseOrderStatus: string }>(claimedRes);
		expect(claimed.purchaseOrderStatus).toBe("QUEUED_FOR_PROCESSING");

		// 5. Daemon reports completion.
		const resultRes = await call("/v1/bridge/result", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok.token}` },
			body: JSON.stringify({
				jobId: job.jobId,
				outcome: "completed",
				ebayOrderId: "EBAY-ABC-001",
				totalCents: 8_750,
				receiptUrl: "https://www.ebay.com/vod/...",
			}),
		});
		expect(resultRes.status).toBe(200);

		// 6. Public read shows terminal state + receipt fields in eBay shape.
		const finalRes = await call(`/v1/buy/order/purchase_order/${queued.purchaseOrderId}`, {
			headers: { Authorization: `Bearer ${key}` },
		});
		const final = await readJson<{
			purchaseOrderStatus: string;
			ebayOrderId?: string;
			receiptUrl?: string;
		}>(finalRes);
		expect(final.purchaseOrderStatus).toBe("PROCESSED");
		expect(final.ebayOrderId).toBe("EBAY-ABC-001");
		expect(final.receiptUrl).toBe("https://www.ebay.com/vod/...");
	});

	it("place_order is idempotent on the same session (returns the same purchase order)", async () => {
		const { key } = await freshKey("integration-bridge+idem@example.com");
		const headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
		const initRes = await call("/v1/buy/order/checkout_session/initiate", {
			method: "POST",
			headers,
			body: JSON.stringify({ lineItems: [{ itemId: "v1|IDEMP|0", quantity: 1 }] }),
		});
		const { checkoutSessionId } = await readJson<{ checkoutSessionId: string }>(initRes);
		const a = await call(`/v1/buy/order/checkout_session/${checkoutSessionId}/place_order`, {
			method: "POST",
			headers,
		});
		const b = await call(`/v1/buy/order/checkout_session/${checkoutSessionId}/place_order`, {
			method: "POST",
			headers,
		});
		const aBody = await readJson<{ purchaseOrderId: string }>(a);
		const bBody = await readJson<{ purchaseOrderId: string }>(b);
		expect(aBody.purchaseOrderId).toBe(bBody.purchaseOrderId);
	});

	it("cancel flips a queued order to CANCELED and is idempotent on a terminal one", async () => {
		const { key } = await freshKey("integration-bridge+cancel@example.com");
		const queued = await quickCheckout(key, "v1|CANCEL|0");
		const c1 = await call(`/v1/buy/order/purchase_order/${queued.purchaseOrderId}/cancel`, {
			method: "POST",
			headers: { Authorization: `Bearer ${key}` },
		});
		expect(c1.status).toBe(200);
		expect((await readJson<{ purchaseOrderStatus: string }>(c1)).purchaseOrderStatus).toBe("CANCELED");

		// Second cancel returns the current state without flipping it.
		const c2 = await call(`/v1/buy/order/purchase_order/${queued.purchaseOrderId}/cancel`, {
			method: "POST",
			headers: { Authorization: `Bearer ${key}` },
		});
		expect(c2.status).toBe(200);
		expect((await readJson<{ purchaseOrderStatus: string }>(c2)).purchaseOrderStatus).toBe("CANCELED");
	});
});

describe("/v1/bridge — auth + ownership", () => {
	it("rejects /v1/bridge/poll without a bridge token", async () => {
		const res = await call("/v1/bridge/poll");
		expect(res.status).toBe(401);
	});

	it("rejects an api key passed where a bridge token is expected", async () => {
		const { key } = await freshKey("integration-bridge+wrongtok@example.com");
		const res = await call("/v1/bridge/poll", { headers: { Authorization: `Bearer ${key}` } });
		expect(res.status).toBe(401);
	});

	it("a different client's bridge token cannot finish someone else's job", async () => {
		const { key: keyA } = await freshKey("integration-bridge+ownerA@example.com");
		const { key: keyB } = await freshKey("integration-bridge+ownerB@example.com");

		const tokA = await readJson<{ token: string }>(
			await call("/v1/bridge/tokens", {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${keyA}` },
				body: JSON.stringify({}),
			}),
		);
		const tokB = await readJson<{ token: string }>(
			await call("/v1/bridge/tokens", {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${keyB}` },
				body: JSON.stringify({}),
			}),
		);

		// A initiates + places, A's bridge client claims.
		const initRes = await call("/v1/buy/order/checkout_session/initiate", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${keyA}` },
			body: JSON.stringify({ lineItems: [{ itemId: "v1|OWNER|0", quantity: 1 }] }),
		});
		const session = await readJson<{ checkoutSessionId: string }>(initRes);
		const queued = await readJson<{ purchaseOrderId: string }>(
			await call(`/v1/buy/order/checkout_session/${session.checkoutSessionId}/place_order`, {
				method: "POST",
				headers: { Authorization: `Bearer ${keyA}` },
			}),
		);
		await call("/v1/bridge/poll", { headers: { Authorization: `Bearer ${tokA.token}` } });

		// B's bridge client tries to report. 404 not_owner.
		const bad = await call("/v1/bridge/result", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokB.token}` },
			body: JSON.stringify({ jobId: queued.purchaseOrderId, outcome: "completed" }),
		});
		expect(bad.status).toBe(404);
	});
});

describe("/v1/webhooks — register / list / revoke", () => {
	it("registers, returns secret once, then lists without it", async () => {
		const { key } = await freshKey("integration-bridge+wh@example.com");
		const registerRes = await call("/v1/webhooks", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
			body: JSON.stringify({
				url: "https://example.test/hook",
				events: ["order.queued", "order.completed"],
				description: "test",
			}),
		});
		expect(registerRes.status).toBe(201);
		const registered = await readJson<{ id: string; secret: string }>(registerRes);
		expect(registered.secret.startsWith("whsec_")).toBe(true);

		const listRes = await call("/v1/webhooks", { headers: { Authorization: `Bearer ${key}` } });
		const list = await readJson<{ endpoints: Array<{ id: string; url: string } & Record<string, unknown>> }>(listRes);
		const found = list.endpoints.find((e) => e.id === registered.id);
		expect(found?.url).toBe("https://example.test/hook");
		expect(found).not.toHaveProperty("secret");

		const delRes = await call(`/v1/webhooks/${registered.id}`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${key}` },
		});
		expect(delRes.status).toBe(204);

		const listAfter = await readJson<{ endpoints: unknown[] }>(
			await call("/v1/webhooks", { headers: { Authorization: `Bearer ${key}` } }),
		);
		expect((listAfter.endpoints as Array<{ id: string }>).find((e) => e.id === registered.id)).toBeUndefined();
	});
});

describe("webhook delivery signing", () => {
	it("verifySignature accepts what signPayload produced", () => {
		const secret = "whsec_test_abc123";
		const body = JSON.stringify({ id: "delivery-1", type: "order.queued" });
		const t = Math.floor(Date.now() / 1000);
		const header = signPayload(secret, body, t);
		expect(verifySignature(secret, body, header, 60)).toBe(true);
		expect(verifySignature("whsec_other_secret", body, header, 60)).toBe(false);
	});

	it("dispatchOrderEvent POSTs to subscribed endpoints with a valid signature", async () => {
		const { key, keyId } = await freshKey("integration-bridge+dispatch@example.com");
		const registered = await readJson<{ id: string; secret: string }>(
			await call("/v1/webhooks", {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
				body: JSON.stringify({
					url: "https://example.test/dispatch",
					events: ["order.queued"],
				}),
			}),
		);

		// Capture every fetch call this dispatch makes.
		const calls: Array<{ url: string; signature: string; body: string }> = [];
		const stubFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
			const sig = (init?.headers as Record<string, string> | undefined)?.["Flipagent-Signature"] ?? "";
			calls.push({ url: String(url), signature: sig, body: String(init?.body ?? "") });
			return new Response("ok", { status: 200 });
		}) as unknown as typeof globalThis.fetch;

		// Build a synthetic order row matching what the queue service writes.
		const [row] = await db
			.insert(purchaseOrders)
			.values({
				apiKeyId: keyId,
				userId: null,
				source: "ebay",
				itemId: "v1|DISPATCH|0",
				quantity: 1,
				maxPriceCents: null,
				idempotencyKey: null,
				metadata: null,
				status: "queued",
				expiresAt: new Date(Date.now() + 60_000),
			})
			.returning();
		if (!row) throw new Error("test setup failed");

		await dispatchOrderEvent(keyId, row, { fetchImpl: stubFetch });

		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("https://example.test/dispatch");
		expect(verifySignature(registered.secret, calls[0]!.body, calls[0]!.signature, 60)).toBe(true);

		// Persisted delivery row says delivered.
		const deliveries = await db
			.select()
			.from(webhookDeliveries)
			.where(eq(webhookDeliveries.endpointId, registered.id));
		expect(deliveries).toHaveLength(1);
		expect(deliveries[0]?.status).toBe("delivered");
		expect(deliveries[0]?.responseStatus).toBe(200);
	});
});
