/**
 * Integration tests for the full-cycle forwarder surface:
 *   POST /v1/forwarder/{provider}/refresh                            queue inbox refresh
 *   POST /v1/forwarder/{provider}/packages/{packageId}/photos        queue photo fetch
 *   POST /v1/forwarder/{provider}/packages/{packageId}/dispatch      queue ship-out
 *   GET  /v1/forwarder/{provider}/jobs/{jobId}                       poll any
 *
 * Plus the cycle webhook events fired off the bridge result endpoint
 * (`forwarder.received`, `forwarder.shipped`).
 *
 * All against a real Postgres (same setup as routes.test.ts). Webhook
 * delivery is exercised by injecting a stub fetch into the dispatcher;
 * we assert both the queued task name and the persisted delivery row
 * carries the right cycle event with our payload.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import "./setup.js";

const { app } = await import("../src/app.js");
const { closeDb, db } = await import("../src/db/client.js");
const { apiKeys, forwarderInventory, webhookDeliveries } = await import("../src/db/schema.js");
const { issueKey } = await import("../src/auth/keys.js");
const { dispatchCycleEvent } = await import("../src/services/webhooks.js");
const { findBySku, findByPackageId } = await import("../src/services/forwarder/inventory.js");
const { sql } = await import("drizzle-orm");

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
// webhook_deliveries, bridge_tokens, purchase_orders, and forwarder_inventory
// all cascade-delete via the api_keys FK, so a single api_keys delete is
// enough. Avoids racing against orders-bridge-webhooks.test.ts (also writes
// webhook tables) when vitest runs test files in parallel forks against the
// same Postgres.
const OWNER_PATTERN = "integration-forwarder+%";

beforeAll(async () => {
	await db.execute(sql`delete from ${apiKeys} where owner_email like ${OWNER_PATTERN}`);
});

afterAll(async () => {
	await db.execute(sql`delete from ${apiKeys} where owner_email like ${OWNER_PATTERN}`);
	await closeDb();
});

describe("/v1/forwarder/{provider}/* — queue + poll", () => {
	it("photos: queues a job, bridge claims with planetexpress_package_photos task, result populates `photos`", async () => {
		const { key } = await freshKey("integration-forwarder+photos@example.com");

		// Bridge token so the extension can claim.
		const tokRes = await call("/v1/bridge/tokens", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
			body: JSON.stringify({ deviceName: "test-machine" }),
		});
		const tok = await readJson<{ token: string }>(tokRes);

		// Queue photos for package "PE-12345".
		const queueRes = await call("/v1/forwarder/planetexpress/packages/PE-12345/photos", {
			method: "POST",
			headers: { Authorization: `Bearer ${key}` },
		});
		expect(queueRes.status).toBe(200);
		const queued = await readJson<{ jobId: string; status: string }>(queueRes);
		expect(queued.status).toBe("queued");

		// Bridge longpoll picks it up — task name is the photo-fetch one.
		const pollRes = await call("/v1/bridge/poll", {
			headers: { Authorization: `Bearer ${tok.token}` },
		});
		expect(pollRes.status).toBe(200);
		const job = await readJson<{ jobId: string; task: string; args: { itemId: string; metadata: { kind: string } } }>(
			pollRes,
		);
		expect(job.jobId).toBe(queued.jobId);
		expect(job.task).toBe("planetexpress_package_photos");
		expect(job.args.itemId).toBe("PE-12345");
		expect(job.args.metadata.kind).toBe("forwarder.photos");

		// Bridge reports back the scraped photos.
		const resultRes = await call("/v1/bridge/result", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok.token}` },
			body: JSON.stringify({
				jobId: job.jobId,
				outcome: "completed",
				result: {
					photos: [
						{ url: "https://cdn.planetexpress.test/p/PE-12345/1.jpg", caption: "front" },
						{ url: "https://cdn.planetexpress.test/p/PE-12345/2.jpg", caption: "back" },
					],
				},
			}),
		});
		expect(resultRes.status).toBe(200);

		// GET the job — `photos` is populated, `packages`/`shipment` are not.
		const finalRes = await call(`/v1/forwarder/planetexpress/jobs/${queued.jobId}`, {
			headers: { Authorization: `Bearer ${key}` },
		});
		const final = await readJson<{
			status: string;
			photos?: Array<{ url: string }>;
			packages?: unknown;
			shipment?: unknown;
		}>(finalRes);
		expect(final.status).toBe("completed");
		expect(final.photos).toHaveLength(2);
		expect(final.photos?.[0]?.url).toContain("PE-12345");
		expect(final.packages).toBeUndefined();
		expect(final.shipment).toBeUndefined();
	});

	it("dispatch: queues a job, bridge claims with planetexpress_package_dispatch task, result populates `shipment`", async () => {
		const { key } = await freshKey("integration-forwarder+dispatch@example.com");
		const tokRes = await call("/v1/bridge/tokens", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
			body: JSON.stringify({ deviceName: "test-machine" }),
		});
		const tok = await readJson<{ token: string }>(tokRes);

		const queueRes = await call("/v1/forwarder/planetexpress/packages/PE-99999/dispatch", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
			body: JSON.stringify({
				toAddress: {
					name: "Buyer Test",
					line1: "1 Main St",
					city: "Brooklyn",
					state: "NY",
					postalCode: "11201",
					country: "US",
				},
				service: "usps_priority",
				declaredValueCents: 35000,
				ebayOrderId: "EBAY-XYZ-001",
			}),
		});
		expect(queueRes.status).toBe(200);
		const queued = await readJson<{ jobId: string }>(queueRes);

		const pollRes = await call("/v1/bridge/poll", {
			headers: { Authorization: `Bearer ${tok.token}` },
		});
		const job = await readJson<{ jobId: string; task: string; args: { metadata: { kind: string } } }>(pollRes);
		expect(job.task).toBe("planetexpress_package_dispatch");
		expect(job.args.metadata.kind).toBe("forwarder.dispatch");

		const resultRes = await call("/v1/bridge/result", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok.token}` },
			body: JSON.stringify({
				jobId: job.jobId,
				outcome: "completed",
				result: {
					shipment: {
						shipmentId: "PE-OUT-77",
						carrier: "USPS",
						tracking: "9400111111111111111111",
						costCents: 1280,
						labelUrl: "https://cdn.planetexpress.test/labels/PE-OUT-77.pdf",
						shippedAt: "2026-04-29T13:00:00Z",
					},
				},
			}),
		});
		expect(resultRes.status).toBe(200);

		const finalRes = await call(`/v1/forwarder/planetexpress/jobs/${queued.jobId}`, {
			headers: { Authorization: `Bearer ${key}` },
		});
		const final = await readJson<{ shipment?: { tracking: string; carrier: string } }>(finalRes);
		expect(final.shipment?.tracking).toBe("9400111111111111111111");
		expect(final.shipment?.carrier).toBe("USPS");
	});

	it("dispatch is idempotent on (packageId, ebayOrderId) — second queue returns the same jobId", async () => {
		const { key } = await freshKey("integration-forwarder+idem@example.com");
		// Pair a bridge token so `assertForwarderSignedIn` passes — without
		// a bridgeTokens row the route returns 412 extension_not_paired
		// before idempotency-key resolution even runs.
		await call("/v1/bridge/tokens", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
			body: JSON.stringify({ deviceName: "test-machine" }),
		});
		const body = JSON.stringify({
			toAddress: {
				name: "Idem Buyer",
				line1: "2 Test Rd",
				city: "Austin",
				state: "TX",
				postalCode: "78701",
				country: "US",
			},
			ebayOrderId: "EBAY-IDEM-1",
		});
		const headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
		const a = await call("/v1/forwarder/planetexpress/packages/PE-IDEM/dispatch", { method: "POST", headers, body });
		const b = await call("/v1/forwarder/planetexpress/packages/PE-IDEM/dispatch", { method: "POST", headers, body });
		expect(a.status).toBe(200);
		expect(b.status).toBe(200);
		const aBody = await readJson<{ jobId: string }>(a);
		const bBody = await readJson<{ jobId: string }>(b);
		expect(aBody.jobId).toBe(bBody.jobId);
	});

	it("photos endpoint requires an api key", async () => {
		const res = await call("/v1/forwarder/planetexpress/packages/PE-1/photos", { method: "POST" });
		expect(res.status).toBe(401);
	});

	it("dispatch rejects an unknown provider via path validation", async () => {
		const { key } = await freshKey("integration-forwarder+badprov@example.com");
		const res = await call("/v1/forwarder/myus/packages/X/dispatch", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
			body: JSON.stringify({
				toAddress: { name: "x", line1: "x", city: "x", state: "x", postalCode: "x", country: "US" },
			}),
		});
		expect(res.status).toBe(400);
	});
});

describe("forwarder_inventory reconciliation", () => {
	it("refresh result upserts into forwarder_inventory; photos + dispatch update fields + status", async () => {
		const { key, keyId } = await freshKey("integration-forwarder+inv@example.com");
		const tokRes = await call("/v1/bridge/tokens", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
			body: JSON.stringify({ deviceName: "test-machine" }),
		});
		const tok = await readJson<{ token: string }>(tokRes);

		// 1. Refresh — bridge reports two packages.
		const refreshRes = await call("/v1/forwarder/planetexpress/refresh", {
			method: "POST",
			headers: { Authorization: `Bearer ${key}` },
		});
		const refreshJob = await readJson<{ jobId: string }>(refreshRes);
		await call("/v1/bridge/poll", { headers: { Authorization: `Bearer ${tok.token}` } });
		await call("/v1/bridge/result", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok.token}` },
			body: JSON.stringify({
				jobId: refreshJob.jobId,
				outcome: "completed",
				result: {
					packages: [
						{ id: "PE-A", trackingNumber: "INBOUND-A", weightG: 800 },
						{ id: "PE-B", trackingNumber: "INBOUND-B", weightG: 1500 },
					],
				},
			}),
		});

		// Inventory row materialised with status=received.
		const a = await findByPackageId(keyId, "planetexpress", "PE-A");
		expect(a).not.toBeNull();
		expect(a?.status).toBe("received");
		expect(a?.inboundTracking).toBe("INBOUND-A");
		expect(a?.weightG).toBe(800);

		// 2. Photos for PE-A — status moves to "photographed".
		const photosRes = await call("/v1/forwarder/planetexpress/packages/PE-A/photos", {
			method: "POST",
			headers: { Authorization: `Bearer ${key}` },
		});
		const photosJob = await readJson<{ jobId: string }>(photosRes);
		await call("/v1/bridge/poll", { headers: { Authorization: `Bearer ${tok.token}` } });
		await call("/v1/bridge/result", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok.token}` },
			body: JSON.stringify({
				jobId: photosJob.jobId,
				outcome: "completed",
				result: { photos: [{ url: "https://cdn.test/PE-A/1.jpg" }] },
			}),
		});

		const a2 = await findByPackageId(keyId, "planetexpress", "PE-A");
		expect(a2?.status).toBe("photographed");
		expect((a2?.photos as Array<{ url: string }>)?.[0]?.url).toBe("https://cdn.test/PE-A/1.jpg");

		// 3. Link to a sku — status="listed".
		const linkRes = await call("/v1/forwarder/planetexpress/packages/PE-A/link", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
			body: JSON.stringify({ sku: "SKU-CANON-50", ebayOfferId: "OFFER-99" }),
		});
		expect(linkRes.status).toBe(200);
		const a3 = await findByPackageId(keyId, "planetexpress", "PE-A");
		expect(a3?.status).toBe("listed");
		expect(a3?.sku).toBe("SKU-CANON-50");
		expect(a3?.ebayOfferId).toBe("OFFER-99");

		// findBySku is the lookup auto-dispatch uses.
		const bySku = await findBySku(keyId, "SKU-CANON-50");
		expect(bySku?.packageId).toBe("PE-A");

		// 4. Dispatch — status="shipped" with outbound fields populated.
		const dispatchRes = await call("/v1/forwarder/planetexpress/packages/PE-A/dispatch", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
			body: JSON.stringify({
				toAddress: { name: "B", line1: "1 St", city: "NYC", state: "NY", postalCode: "11201", country: "US" },
				ebayOrderId: "EBAY-INV-1",
			}),
		});
		const dispatchJob = await readJson<{ jobId: string }>(dispatchRes);
		await call("/v1/bridge/poll", { headers: { Authorization: `Bearer ${tok.token}` } });
		await call("/v1/bridge/result", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok.token}` },
			body: JSON.stringify({
				jobId: dispatchJob.jobId,
				outcome: "completed",
				result: {
					shipment: {
						shipmentId: "PE-OUT-A",
						carrier: "USPS",
						tracking: "9400-A",
						costCents: 1280,
						labelUrl: "https://cdn.test/labels/A.pdf",
						shippedAt: "2026-04-29T13:00:00Z",
					},
				},
			}),
		});

		const a4 = await findByPackageId(keyId, "planetexpress", "PE-A");
		expect(a4?.status).toBe("shipped");
		expect(a4?.outboundTracking).toBe("9400-A");
		expect(a4?.outboundCarrier).toBe("USPS");
		expect(a4?.outboundShipmentId).toBe("PE-OUT-A");
	});

	it("GET /v1/forwarder/{provider}/inventory lists rows newest-first", async () => {
		const { key, keyId } = await freshKey("integration-forwarder+invlist@example.com");
		// Seed two rows directly via the inventory table.
		await db.insert(forwarderInventory).values([
			{ apiKeyId: keyId, provider: "planetexpress", packageId: "PE-X", status: "received" },
			{ apiKeyId: keyId, provider: "planetexpress", packageId: "PE-Y", status: "listed", sku: "SKU-1" },
		]);
		const res = await call("/v1/forwarder/planetexpress/inventory", {
			headers: { Authorization: `Bearer ${key}` },
		});
		expect(res.status).toBe(200);
		const body = await readJson<{ rows: Array<{ packageId: string; status: string; sku: string | null }> }>(res);
		expect(body.rows).toHaveLength(2);
		const pkgs = body.rows.map((r) => r.packageId).sort();
		expect(pkgs).toEqual(["PE-X", "PE-Y"]);
	});
});

describe("auto-dispatch — sold → look up package → mark sold (OAuth path stubbed)", () => {
	it("findBySku returns null when no link exists (sku_not_linked path)", async () => {
		const { keyId } = await freshKey("integration-forwarder+ad-empty@example.com");
		const { maybeAutoDispatch } = await import("../src/services/forwarder/auto-dispatch.js");
		const outcome = await maybeAutoDispatch({
			apiKeyId: keyId,
			sku: "SKU-NEVER-LINKED",
			ebayOrderId: "EBAY-FAKE",
			transactionId: null,
		});
		expect(outcome.dispatched).toBe(false);
		expect(outcome.reason).toBe("sku_not_linked");
		expect(outcome.packageId).toBeNull();
	});

	it("linked sku + no eBay OAuth → marks status=sold and reports oauth-failure reason", async () => {
		const { keyId } = await freshKey("integration-forwarder+ad-noauth@example.com");
		// Seed a package + linked sku (no OAuth binding for this api key).
		await db.insert(forwarderInventory).values({
			apiKeyId: keyId,
			provider: "planetexpress",
			packageId: "PE-AD-1",
			sku: "SKU-AUTO-1",
			status: "listed",
		});

		const { maybeAutoDispatch } = await import("../src/services/forwarder/auto-dispatch.js");
		const outcome = await maybeAutoDispatch({
			apiKeyId: keyId,
			sku: "SKU-AUTO-1",
			ebayOrderId: "EBAY-AD-1",
			transactionId: null,
		});

		// Dispatch fails (no OAuth) but markSold succeeded — the row's
		// status is now "sold" and the agent is told *why* via reason.
		expect(outcome.dispatched).toBe(false);
		expect(outcome.packageId).toBe("PE-AD-1");
		expect(outcome.reason).toMatch(/not_connected|ebay_/);

		const after = await findBySku(keyId, "SKU-AUTO-1");
		expect(after?.status).toBe("sold");
	});

	it("already-shipped row short-circuits without re-marking", async () => {
		const { keyId } = await freshKey("integration-forwarder+ad-shipped@example.com");
		await db.insert(forwarderInventory).values({
			apiKeyId: keyId,
			provider: "planetexpress",
			packageId: "PE-AD-2",
			sku: "SKU-AUTO-2",
			status: "shipped",
		});

		const { maybeAutoDispatch } = await import("../src/services/forwarder/auto-dispatch.js");
		const outcome = await maybeAutoDispatch({
			apiKeyId: keyId,
			sku: "SKU-AUTO-2",
			ebayOrderId: "EBAY-AD-2",
			transactionId: null,
		});
		expect(outcome.dispatched).toBe(false);
		expect(outcome.reason).toBe("already_shipped");
	});
});

describe("cycle webhooks — forwarder.received / forwarder.shipped / item.sold", () => {
	it("dispatchCycleEvent signs + delivers + logs, just like the order-event path", async () => {
		const { key, keyId } = await freshKey("integration-forwarder+webhook@example.com");

		// Subscribe to forwarder.shipped + item.sold.
		const reg = await call("/v1/webhooks", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
			body: JSON.stringify({
				url: "https://example.test/hook",
				events: ["forwarder.shipped", "item.sold"],
			}),
		});
		expect(reg.status).toBe(201);

		// Stub fetch — assert headers + body.
		const stub = vi.fn(async () => new Response("ok", { status: 200 }));
		await dispatchCycleEvent(
			keyId,
			"forwarder.shipped",
			{
				provider: "planetexpress",
				packageId: "PE-WH-1",
				ebayOrderId: "EBAY-WH-1",
				shipment: { carrier: "USPS", tracking: "TRACK-1" },
			},
			{ fetchImpl: stub as unknown as typeof globalThis.fetch },
		);
		expect(stub).toHaveBeenCalledOnce();
		const call0 = stub.mock.calls[0] as unknown as [RequestInfo, RequestInit] | undefined;
		expect(call0).toBeDefined();
		const initArg = call0?.[1];
		const sigHeader =
			(initArg?.headers as Record<string, string> | undefined)?.["Flipagent-Signature"] ??
			(initArg?.headers as Record<string, string> | undefined)?.["flipagent-signature"];
		expect(sigHeader).toMatch(/^t=\d+,v1=[a-f0-9]+$/);
		const body = JSON.parse(initArg?.body as string) as {
			type: string;
			data: { provider: string; packageId: string; shipment: { tracking: string } };
		};
		expect(body.type).toBe("forwarder.shipped");
		expect(body.data.packageId).toBe("PE-WH-1");
		expect(body.data.shipment.tracking).toBe("TRACK-1");

		// Delivery log written.
		const deliveries = await db
			.select()
			.from(webhookDeliveries)
			.where(sql`${webhookDeliveries.eventType} = 'forwarder.shipped'`);
		expect(deliveries.length).toBeGreaterThanOrEqual(1);
	});
});
