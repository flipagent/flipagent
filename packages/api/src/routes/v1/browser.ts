/**
 * `/v1/browser/*` — synchronous browser primitives that round-trip
 * through the bridge protocol. Each call:
 *   1. queues a purchase_order with source=browser + metadata.op=...
 *   2. waits up to 25 s for the bridge client to claim and report
 *   3. returns the inline result (or 504 on timeout)
 *
 * Use sparingly from agent code — these calls block. Today they exist
 * mainly so an LLM (or interactive dev session) can probe DOM without
 * shipping new content-script code per iteration.
 */

import { BrowserCookiesRequest, BrowserCookiesResponse, BrowserQueryRequest, BrowserQueryResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { createBridgeJob, waitForTerminal } from "../../services/bridge-jobs.js";
import { nextAction } from "../../services/shared/next-action.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const browserRoute = new Hono();

browserRoute.post(
	"/query",
	describeRoute({
		tags: ["Browser"],
		summary: "DOM querySelectorAll on the active tab via the bridge client",
		description:
			"Synchronous: queues a `browser_op` job, waits up to 25 s for the extension to execute the query in the active tab, returns matched elements (text + outerHTML, capped). Returns 504 if the extension didn't respond in time. 1st-class surface for direct DOM access — useful when the high-level tools don't cover the read (custom marketplace, new field) or for interactive selector tuning during dev.",
		responses: {
			200: jsonResponse("Query result.", BrowserQueryResponse),
			401: errorResponse("Missing or invalid API key."),
			504: errorResponse("Bridge client did not respond in time."),
		},
	}),
	requireApiKey,
	tbBody(BrowserQueryRequest),
	async (c) => {
		const body = c.req.valid("json");
		const key = c.var.apiKey;
		const job = await createBridgeJob({
			apiKeyId: key.id,
			userId: key.userId,
			source: "browser",
			itemId: "browser_op",
			quantity: 1,
			maxPriceCents: null,
			idempotencyKey: null,
			metadata: {
				op: "query",
				selector: body.selector,
				limit: body.limit ?? 10,
				includeHtml: body.includeHtml ?? true,
				includeText: body.includeText ?? true,
				truncateAt: body.truncateAt ?? 2000,
				tabUrlPattern: body.tabUrlPattern ?? null,
			},
		});
		const final = await waitForTerminal(job.id, key.id, 25_000);
		if (!final || final.status !== "completed" || !final.result) {
			return c.json(
				{
					error: "browser_op_timeout",
					message: `Bridge client did not respond. status=${final?.status ?? "?"} reason=${final?.failureReason ?? "?"}`,
					next_action: nextAction(c, "extension_install"),
				},
				504,
			);
		}
		return c.json(final.result);
	},
);

browserRoute.post(
	"/cookies",
	describeRoute({
		tags: ["Browser"],
		summary: "Inventory cookies for a domain via the bridge client",
		description:
			"Synchronous: queues a `browser_op` with op=cookies, waits for the extension's background to call `chrome.cookies.getAll({ domain })`, returns metadata only (name, expiry, httpOnly, secure, sameSite). Cookie *values* are never returned. Use this to measure real session expiry — HttpOnly auth cookies (eBay's `ds2`/`npii`, PE's session) aren't visible to `document.cookie`, so DOM probing can't see when the session actually breaks. Caller can compute time-to-expiry from `earliestExpiresAt`.",
		responses: {
			200: jsonResponse("Cookies inventoried.", BrowserCookiesResponse),
			401: errorResponse("Missing or invalid API key."),
			504: errorResponse("Bridge client did not respond in time."),
		},
	}),
	requireApiKey,
	tbBody(BrowserCookiesRequest),
	async (c) => {
		const body = c.req.valid("json");
		const key = c.var.apiKey;
		const job = await createBridgeJob({
			apiKeyId: key.id,
			userId: key.userId,
			source: "browser",
			itemId: "browser_op",
			quantity: 1,
			maxPriceCents: null,
			idempotencyKey: null,
			metadata: { op: "cookies", domain: body.domain },
		});
		const final = await waitForTerminal(job.id, key.id, 25_000);
		if (!final || final.status !== "completed" || !final.result) {
			return c.json(
				{
					error: "browser_op_timeout",
					message: `Bridge client did not respond. status=${final?.status ?? "?"} reason=${final?.failureReason ?? "?"}`,
					next_action: nextAction(c, "extension_install"),
				},
				504,
			);
		}
		return c.json(final.result);
	},
);
