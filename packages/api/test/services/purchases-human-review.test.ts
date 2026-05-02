import "../setup.js";

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { issueKey } from "../../src/auth/keys.js";
import { purchasesRoute } from "../../src/routes/v1/purchases.js";

/**
 * eBay UA Feb-2026 buy-bot ban: `humanReviewedAt` must be present + ≤5 minutes
 * old when the transport is bridge or Order API isn't approved. Verified at
 * the route layer so SDK callers get the same gate.
 */

const app = new Hono().route("/v1/purchases", purchasesRoute);

async function freshKey(email: string): Promise<string> {
	const issued = await issueKey({ tier: "growth", ownerEmail: email });
	return issued.plaintext;
}

async function call(body: Record<string, unknown>, key: string) {
	return app.request("/v1/purchases", {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
		body: JSON.stringify(body),
	});
}

describe("/v1/purchases — humanReviewedAt freshness gate", () => {
	it("rejects requests with no humanReviewedAt (412 human_review_required)", async () => {
		const key = await freshKey("integration-purchases+missing@example.com");
		const res = await call({ items: [{ itemId: "v1|HR1|0", quantity: 1 }] }, key);
		expect(res.status).toBe(412);
		const body = (await res.json()) as { code?: string; error?: string };
		expect(body.code ?? body.error).toMatch(/human_review_required/);
	});

	it("rejects stale humanReviewedAt > 5 minutes (412 human_review_stale)", async () => {
		const key = await freshKey("integration-purchases+stale@example.com");
		const stale = new Date(Date.now() - 6 * 60 * 1000).toISOString();
		const res = await call({ items: [{ itemId: "v1|HR2|0", quantity: 1 }], humanReviewedAt: stale }, key);
		const body = (await res.json()) as { code?: string; error?: string; message?: string };
		expect(res.status, JSON.stringify(body)).toBe(412);
		expect(body.code ?? body.error).toMatch(/human_review_stale/);
	});

	it("rejects malformed humanReviewedAt (412 human_review_required)", async () => {
		const key = await freshKey("integration-purchases+bad@example.com");
		const res = await call({ items: [{ itemId: "v1|HR3|0", quantity: 1 }], humanReviewedAt: "not-a-date" }, key);
		expect(res.status).toBe(412);
		const body = (await res.json()) as { code?: string; error?: string };
		expect(body.code ?? body.error).toMatch(/human_review_required/);
	});

	it("accepts a fresh humanReviewedAt and proceeds past the gate", async () => {
		// Past the gate the orchestrator hits the bridge / REST transports;
		// without bridge pairing or Order API approval the call ultimately
		// fails downstream. We just assert the freshness gate didn't trip
		// (i.e. status is NOT 412 with `human_review_*` codes).
		const key = await freshKey("integration-purchases+fresh@example.com");
		const res = await call(
			{ items: [{ itemId: "v1|HR4|0", quantity: 1 }], humanReviewedAt: new Date().toISOString() },
			key,
		);
		const body = (await res.json().catch(() => ({}))) as { code?: string };
		expect(body.code ?? "").not.toMatch(/human_review_/);
	});
});
