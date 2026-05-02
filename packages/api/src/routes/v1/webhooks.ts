/**
 * `/v1/webhooks/*` — **outbound** event subscriptions. flipagent → caller.
 * The caller registers a delivery URL here and we sign + POST events to
 * it. Distinct from `/v1/notifications/*`, which is **inbound** from
 * marketplaces (eBay → flipagent).
 *
 *   POST   /v1/webhooks       — register a delivery URL + event filter.
 *                                Returns the row plus the shared HMAC secret;
 *                                the secret is shown once.
 *   GET    /v1/webhooks       — list non-revoked endpoints for this api key.
 *   DELETE /v1/webhooks/{id}  — revoke. Soft-delete (revokedAt set) so
 *                                delivery history survives.
 *
 * Deliveries are signed `Flipagent-Signature: t=…,v1=…` (Stripe-style HMAC
 * over `<timestamp>.<rawBody>`). See `services/webhooks/dispatch.ts`.
 */

import { ListWebhooksResponse, RegisterWebhookRequest, RegisterWebhookResponse } from "@flipagent/types";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { encryptSecret } from "../../auth/secret-envelope.js";
import { db } from "../../db/client.js";
import { webhookEndpoints } from "../../db/schema.js";
import { requireApiKey } from "../../middleware/auth.js";
import { generateWebhookSecret } from "../../services/webhooks.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const webhooksRoute = new Hono();

webhooksRoute.post(
	"/",
	describeRoute({
		tags: ["Webhooks"],
		summary: "Register a webhook endpoint",
		description:
			"Returns the secret in the response — store it on the receiver to verify the `Flipagent-Signature` header on incoming deliveries. The secret is shown only at registration; it cannot be retrieved later.",
		responses: {
			201: jsonResponse("Webhook registered.", RegisterWebhookResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
		},
	}),
	requireApiKey,
	tbBody(RegisterWebhookRequest),
	async (c) => {
		const body = c.req.valid("json");
		const secret = generateWebhookSecret();
		// Webhook HMAC secret stored under the secrets envelope; the
		// signing path decrypts at use. Plaintext is shown to the caller
		// exactly once in this response — they're responsible for storing
		// it on their receiver.
		const [row] = await db
			.insert(webhookEndpoints)
			.values({
				apiKeyId: c.var.apiKey.id,
				userId: c.var.apiKey.userId,
				url: body.url,
				secret: encryptSecret(secret),
				events: body.events,
				description: body.description ?? null,
			})
			.returning();
		if (!row) return c.json({ error: "insert_failed", message: "Could not register webhook." }, 500);
		return c.json(
			{
				id: row.id,
				url: row.url,
				events: row.events as RegisterWebhookRequest["events"],
				description: row.description,
				createdAt: row.createdAt.toISOString(),
				lastDeliveryAt: row.lastDeliveryAt ? row.lastDeliveryAt.toISOString() : null,
				lastErrorAt: row.lastErrorAt ? row.lastErrorAt.toISOString() : null,
				secret,
			},
			201,
		);
	},
);

webhooksRoute.get(
	"/",
	describeRoute({
		tags: ["Webhooks"],
		summary: "List active webhook endpoints",
		responses: {
			200: jsonResponse("Endpoint list (secrets are not returned).", ListWebhooksResponse),
			401: errorResponse("Missing or invalid API key."),
		},
	}),
	requireApiKey,
	async (c) => {
		const rows = await db
			.select()
			.from(webhookEndpoints)
			.where(and(eq(webhookEndpoints.apiKeyId, c.var.apiKey.id), isNull(webhookEndpoints.revokedAt)))
			.orderBy(desc(webhookEndpoints.createdAt));
		return c.json({
			endpoints: rows.map((r) => ({
				id: r.id,
				url: r.url,
				events: r.events as RegisterWebhookRequest["events"],
				description: r.description,
				createdAt: r.createdAt.toISOString(),
				lastDeliveryAt: r.lastDeliveryAt ? r.lastDeliveryAt.toISOString() : null,
				lastErrorAt: r.lastErrorAt ? r.lastErrorAt.toISOString() : null,
			})),
		});
	},
);

webhooksRoute.delete(
	"/:id",
	describeRoute({
		tags: ["Webhooks"],
		summary: "Revoke a webhook endpoint (soft-delete)",
		responses: {
			204: { description: "Revoked." },
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Endpoint not found for this api key."),
		},
	}),
	requireApiKey,
	async (c) => {
		const id = c.req.param("id");
		const [row] = await db
			.update(webhookEndpoints)
			.set({ revokedAt: new Date() })
			.where(
				and(
					eq(webhookEndpoints.id, id),
					eq(webhookEndpoints.apiKeyId, c.var.apiKey.id),
					isNull(webhookEndpoints.revokedAt),
				),
			)
			.returning();
		if (!row) return c.json({ error: "not_found", message: `No active webhook ${id}.` }, 404);
		return new Response(null, { status: 204 });
	},
);
