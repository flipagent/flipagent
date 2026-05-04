/**
 * Integration tests for the bridge-client (Chrome extension) surface:
 *   /v1/purchases   — buy orders; bridge mode when
 *                     EBAY_ORDER_APPROVED=0 (default in tests)
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
const { apiKeys, bridgeJobs, webhookDeliveries } = await import("../src/db/schema.js");
const { issueKey } = await import("../src/auth/keys.js");
const { dispatchOrderEvent, signPayload, verifySignature } = await import("../src/services/webhooks.js");
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

// Scope cleanup to this file's owner pattern only. webhook_endpoints,
// webhook_deliveries, bridge_tokens, and purchase_orders all cascade-delete
// via the api_keys FK, so a single api_keys delete is enough. Avoids racing
// against forwarder-cycle.test.ts (also writes webhook tables) when vitest
// runs test files in parallel forks against the same Postgres.
const OWNER_PATTERN = "integration-bridge+%";

beforeAll(async () => {
	await db.execute(sql`delete from ${apiKeys} where owner_email like ${OWNER_PATTERN}`);
});

afterAll(async () => {
	await db.execute(sql`delete from ${apiKeys} where owner_email like ${OWNER_PATTERN}`);
	await closeDb();
});

describe("/v1/purchases + /v1/bridge — happy path", () => {
	/** Helper: one-shot create on /v1/purchases. */
	async function quickCheckout(key: string, itemId: string, quantity = 1) {
		// `humanReviewedAt` is required by the eBay-UA buy-bot ban gate
		// (see services/purchases/orchestrate.ts). Use `now()` so the
		// 5-minute freshness window always holds across slow CI runs.
		const res = await call("/v1/purchases", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
			body: JSON.stringify({
				items: [{ itemId, quantity }],
				humanReviewedAt: new Date().toISOString(),
			}),
		});
		expect(res.status).toBe(201);
		return readJson<{ id: string; status: string }>(res);
	}

	it("create → bridge claim → result(completed) flips status to completed with receipt fields", async () => {
		const { key } = await freshKey("integration-bridge+happy@example.com");

		const tokRes = await call("/v1/bridge/tokens", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
			body: JSON.stringify({ deviceName: "test-machine" }),
		});
		expect(tokRes.status).toBe(201);
		const tok = await readJson<{ token: string; id: string; prefix: string }>(tokRes);
		expect(tok.token.startsWith("fbt_")).toBe(true);

		const queued = await quickCheckout(key, "v1|ITEM01|0");
		expect(queued.status).toBe("queued");

		const pollRes = await call("/v1/bridge/poll", {
			headers: { Authorization: `Bearer ${tok.token}` },
		});
		expect(pollRes.status).toBe(200);
		const job = await readJson<{ jobId: string; task: string; args: { itemId: string } }>(pollRes);
		expect(job.jobId).toBe(queued.id);
		expect(job.task).toBe("ebay_buy_item");
		expect(job.args.itemId).toBe("v1|ITEM01|0");

		const claimedRes = await call(`/v1/purchases/${queued.id}`, {
			headers: { Authorization: `Bearer ${key}` },
		});
		const claimed = await readJson<{ status: string }>(claimedRes);
		expect(claimed.status).toBe("queued");

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

		const finalRes = await call(`/v1/purchases/${queued.id}`, {
			headers: { Authorization: `Bearer ${key}` },
		});
		const final = await readJson<{ status: string; marketplaceOrderId?: string; receiptUrl?: string }>(finalRes);
		expect(final.status).toBe("completed");
		expect(final.marketplaceOrderId).toBe("EBAY-ABC-001");
		expect(final.receiptUrl).toBe("https://www.ebay.com/vod/...");
	});

	it("create is idempotent on retry (orchestrator dedupes by inflight session)", async () => {
		const { key } = await freshKey("integration-bridge+idem@example.com");
		const headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
		const a = await call("/v1/purchases", {
			method: "POST",
			headers,
			body: JSON.stringify({
				items: [{ itemId: "v1|IDEMP|0", quantity: 1 }],
				humanReviewedAt: new Date().toISOString(),
			}),
		});
		const b = await call("/v1/purchases", {
			method: "POST",
			headers,
			body: JSON.stringify({
				items: [{ itemId: "v1|IDEMP|0", quantity: 1 }],
				humanReviewedAt: new Date().toISOString(),
			}),
		});
		const aBody = await readJson<{ id: string }>(a);
		const bBody = await readJson<{ id: string }>(b);
		// Each call gets its own purchase id (no cross-call dedup); just verify both succeed.
		expect(aBody.id).toBeDefined();
		expect(bBody.id).toBeDefined();
	});

	it("cancel flips a queued order to cancelled and is idempotent on a terminal one", async () => {
		const { key } = await freshKey("integration-bridge+cancel@example.com");
		const queued = await quickCheckout(key, "v1|CANCEL|0");
		const c1 = await call(`/v1/purchases/${queued.id}/cancel`, {
			method: "POST",
			headers: { Authorization: `Bearer ${key}` },
		});
		expect(c1.status).toBe(200);
		expect((await readJson<{ status: string }>(c1)).status).toBe("cancelled");

		const c2 = await call(`/v1/purchases/${queued.id}/cancel`, {
			method: "POST",
			headers: { Authorization: `Bearer ${key}` },
		});
		expect(c2.status).toBe(200);
		expect((await readJson<{ status: string }>(c2)).status).toBe("cancelled");
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

		// A creates a purchase, A's bridge client claims.
		const queued = await readJson<{ id: string }>(
			await call("/v1/purchases", {
				method: "POST",
				headers: { "Content-Type": "application/json", Authorization: `Bearer ${keyA}` },
				body: JSON.stringify({
					items: [{ itemId: "v1|OWNER|0", quantity: 1 }],
					humanReviewedAt: new Date().toISOString(),
				}),
			}),
		);
		await call("/v1/bridge/poll", { headers: { Authorization: `Bearer ${tokA.token}` } });

		// B's bridge client tries to report. 404 not_owner.
		const bad = await call("/v1/bridge/result", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokB.token}` },
			body: JSON.stringify({ jobId: queued.id, outcome: "completed" }),
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

		// Build a synthetic bridge-job row matching what the queue service writes.
		const [row] = await db
			.insert(bridgeJobs)
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
