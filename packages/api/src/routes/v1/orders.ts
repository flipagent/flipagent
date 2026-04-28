/**
 * `/v1/orders/*` — buy-side orders driven by the bridge protocol. Today
 * the bridge client is the flipagent Chrome extension running in the
 * user's real browser; the protocol stays generic so future executors
 * (eBay's official Order API once approved) can plug in.
 *
 *   POST /v1/orders/checkout   — queue a purchase for the bridge client to execute.
 *   GET  /v1/orders/{id}       — read status + result.
 *   POST /v1/orders/{id}/cancel — cancel a non-terminal order.
 *
 * `/v1/orders/{id}/confirm` is intentionally absent in v1 — the user
 * confirm step happens in-browser inside the extension (PR2). We can
 * add a server-side confirm endpoint later for remote-AI-agent flows.
 *
 * Surface preempts the eBay Order API passthrough at the same paths
 * (which returns 501 until eBay grants tenant approval). Same
 * `purchase_order_id` lets us swap executors later without SDK churn.
 */

import {
	CheckoutRequest,
	CheckoutResponse,
	PurchaseOrderActionResponse,
	PurchaseOrderResponse,
} from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { cancel, createOrder, getOrderForApiKey, toPublicShape } from "../../services/orders/queue.js";
import { dispatchOrderEvent } from "../../services/webhooks/dispatch.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const ordersRoute = new Hono();

ordersRoute.post(
	"/checkout",
	describeRoute({
		tags: ["Orders"],
		summary: "Queue a buy-side order for the user's bridge client (Chrome extension)",
		description:
			"Returns immediately with a `purchaseOrderId`. The flipagent Chrome extension paired with the user's API key claims the job via the bridge protocol and drives the purchase inside their real eBay session. Poll `GET /v1/orders/{id}` or subscribe to the `order.*` webhook events for status. See /docs/extension/ for install + pairing.",
		responses: {
			201: jsonResponse("Order queued.", CheckoutResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
			429: errorResponse("Rate limit exceeded."),
		},
	}),
	requireApiKey,
	tbBody(CheckoutRequest),
	async (c) => {
		const body = c.req.valid("json");
		const key = c.var.apiKey;
		const order = await createOrder({
			apiKeyId: key.id,
			userId: key.userId,
			source: body.source ?? "ebay",
			itemId: body.itemId,
			quantity: body.quantity ?? 1,
			maxPriceCents: body.maxPriceCents ?? null,
			idempotencyKey: body.idempotencyKey ?? null,
			metadata: (body.metadata as Record<string, unknown> | undefined) ?? null,
		});
		// Best-effort webhook for `order.queued`. Don't block the response.
		dispatchOrderEvent(key.id, order).catch((err) => console.error("[orders] dispatch queued:", err));
		return c.json({ purchaseOrderId: order.id, status: order.status, expiresAt: order.expiresAt.toISOString() }, 201);
	},
);

ordersRoute.get(
	"/:id",
	describeRoute({
		tags: ["Orders"],
		summary: "Read order status + result",
		responses: {
			200: jsonResponse("Order state.", PurchaseOrderResponse),
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Order not found for this api key."),
		},
	}),
	requireApiKey,
	async (c) => {
		const id = c.req.param("id");
		const order = await getOrderForApiKey(id, c.var.apiKey.id);
		if (!order) return c.json({ error: "not_found", message: `No order ${id} for this api key.` }, 404);
		return c.json(toPublicShape(order));
	},
);

ordersRoute.post(
	"/:id/cancel",
	describeRoute({
		tags: ["Orders"],
		summary: "Cancel a non-terminal order",
		description:
			"Transitions queued / claimed / awaiting_user_confirm orders to `cancelled`. Once `placing` or terminal, returns the current state unchanged.",
		responses: {
			200: jsonResponse("Order after cancel attempt.", PurchaseOrderActionResponse),
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Order not found for this api key."),
		},
	}),
	requireApiKey,
	async (c) => {
		const id = c.req.param("id");
		const cancelled = await cancel(id, c.var.apiKey.id);
		if (cancelled) {
			dispatchOrderEvent(c.var.apiKey.id, cancelled).catch((err) =>
				console.error("[orders] dispatch cancelled:", err),
			);
			return c.json(toPublicShape(cancelled));
		}
		// Either not found or already terminal/placing — surface current state if it exists.
		const current = await getOrderForApiKey(id, c.var.apiKey.id);
		if (!current) return c.json({ error: "not_found", message: `No order ${id} for this api key.` }, 404);
		return c.json(toPublicShape(current));
	},
);
