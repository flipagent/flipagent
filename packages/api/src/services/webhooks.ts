/**
 * Webhook delivery — sign + POST + log. Stripe-style:
 *   Flipagent-Signature: t=<unix>,v1=<hex>
 * where the HMAC-SHA256 is taken over `<t>.<rawBody>` using the endpoint's
 * shared secret. Receivers should also reject deliveries with t older than
 * ~5 min to neutralize replay.
 *
 * v1 is fire-and-forget: a state transition fires this synchronously after
 * the DB write, with a short HTTP timeout. Failures persist in
 * `webhook_deliveries` with `nextRetryAt` set; a future worker drains those.
 */

import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import {
	type BridgeJob as DbBridgeJob,
	type WebhookEndpoint as DbWebhookEndpoint,
	type NewWebhookDelivery,
	webhookDeliveries,
	webhookEndpoints,
} from "../db/schema.js";
import { toPublicShape } from "./bridge-jobs.js";

const DELIVERY_TIMEOUT_MS = 5_000;

export function generateWebhookSecret(): string {
	return `whsec_${randomBytes(24).toString("base64url")}`;
}

/**
 * Stable JSON serialization for signing. Plain `JSON.stringify` is fine
 * because we control the input shape (TypeBox-validated); no key reordering
 * concerns since we sign exactly what we send.
 */
export function signPayload(secret: string, rawBody: string, timestamp: number): string {
	const v1 = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
	return `t=${timestamp},v1=${v1}`;
}

/**
 * Verify an inbound signature. Exposed for receivers / our own test harness.
 * Returns true iff one of the comma-separated v1 signatures matches and t
 * is within `toleranceSec`.
 */
export function verifySignature(secret: string, rawBody: string, header: string, toleranceSec: number = 300): boolean {
	const parts = Object.fromEntries(
		header.split(",").map((kv) => {
			const idx = kv.indexOf("=");
			return [kv.slice(0, idx).trim(), kv.slice(idx + 1).trim()];
		}),
	);
	const t = Number(parts.t);
	if (!Number.isFinite(t)) return false;
	if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
	const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
	return safeEqual(expected, parts.v1 ?? "");
}

function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

export type OrderEventType =
	| "order.queued"
	| "order.claimed"
	| "order.awaiting_user_confirm"
	| "order.placing"
	| "order.completed"
	| "order.failed"
	| "order.cancelled"
	| "order.expired";

/**
 * Marketplace + forwarder lifecycle events. Subscribers receive these
 * to drive the connective tissue of the full reseller cycle:
 *
 *   item.sold            an inbound sale notification landed; hook to
 *                        kick off forwarder dispatch from the buyer
 *                        address you fetch off the eBay order.
 *   forwarder.received   refresh detected a new package in the inbox;
 *                        hook to fetch photos + auto-draft a listing.
 *   forwarder.shipped    a dispatch job completed; hook to mark the
 *                        eBay order shipped + supply tracking.
 *
 * Receivers self-discover by registering an endpoint via /v1/webhooks
 * and listing the events they care about. We never assume any
 * particular automation lives server-side — the events are the contract.
 */
export type CycleEventType = "item.sold" | "forwarder.received" | "forwarder.shipped";

export type AnyEventType = OrderEventType | CycleEventType;

export function eventTypeForStatus(status: DbBridgeJob["status"]): OrderEventType {
	return `order.${status}` as OrderEventType;
}

interface DispatchOptions {
	now?: Date;
	fetchImpl?: typeof globalThis.fetch;
}

/**
 * Find subscribed endpoints for the api key + event type, then sign and
 * POST in parallel. Each delivery is logged regardless of outcome.
 */
export async function dispatchOrderEvent(
	apiKeyId: string,
	order: DbBridgeJob,
	opts: DispatchOptions = {},
): Promise<void> {
	const eventType = eventTypeForStatus(order.status);
	const endpoints = await db
		.select()
		.from(webhookEndpoints)
		.where(and(eq(webhookEndpoints.apiKeyId, apiKeyId), isNull(webhookEndpoints.revokedAt)));

	const matching = endpoints.filter((e) => e.events.includes(eventType));
	if (matching.length === 0) return;

	const now = opts.now ?? new Date();
	const envelope = {
		id: randomUUID(),
		type: eventType,
		createdAt: now.toISOString(),
		data: { order: toPublicShape(order) },
	};
	const rawBody = JSON.stringify(envelope);
	const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

	await Promise.all(matching.map((ep) => deliverOne(ep, eventType, envelope, rawBody, fetchImpl)));
}

/**
 * Fire a `item.sold` / `forwarder.received` / `forwarder.shipped`
 * envelope to subscribed endpoints. Same signing + delivery-log
 * machinery as `dispatchOrderEvent`; the only difference is the
 * envelope's `data` payload is event-specific (caller-supplied).
 */
export async function dispatchCycleEvent(
	apiKeyId: string,
	eventType: CycleEventType,
	data: Record<string, unknown>,
	opts: DispatchOptions = {},
): Promise<void> {
	const endpoints = await db
		.select()
		.from(webhookEndpoints)
		.where(and(eq(webhookEndpoints.apiKeyId, apiKeyId), isNull(webhookEndpoints.revokedAt)));

	const matching = endpoints.filter((e) => e.events.includes(eventType));
	if (matching.length === 0) return;

	const now = opts.now ?? new Date();
	const envelope = {
		id: randomUUID(),
		type: eventType,
		createdAt: now.toISOString(),
		data,
	};
	const rawBody = JSON.stringify(envelope);
	const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
	await Promise.all(matching.map((ep) => deliverOne(ep, eventType, envelope, rawBody, fetchImpl)));
}

async function deliverOne(
	endpoint: DbWebhookEndpoint,
	eventType: AnyEventType,
	envelope: unknown,
	rawBody: string,
	fetchImpl: typeof globalThis.fetch,
): Promise<void> {
	const ts = Math.floor(Date.now() / 1000);
	const signature = signPayload(endpoint.secret, rawBody, ts);
	let status: "delivered" | "failed" = "failed";
	let responseStatus: number | null = null;
	let responseBody: string | null = null;
	let nextRetryAt: Date | null = new Date(Date.now() + 60_000);

	try {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), DELIVERY_TIMEOUT_MS);
		const res = await fetchImpl(endpoint.url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Flipagent-Signature": signature,
				"Flipagent-Event-Type": eventType,
			},
			body: rawBody,
			signal: ctrl.signal,
		}).finally(() => clearTimeout(timer));
		responseStatus = res.status;
		responseBody = (await res.text().catch(() => "")).slice(0, 2000);
		if (res.ok) {
			status = "delivered";
			nextRetryAt = null;
		}
	} catch (err) {
		responseBody = (err as Error).message?.slice(0, 2000) ?? "fetch_error";
	}

	const insert: NewWebhookDelivery = {
		endpointId: endpoint.id,
		eventType,
		payload: envelope as Record<string, unknown>,
		status,
		attempt: 1,
		responseStatus,
		responseBody,
		nextRetryAt,
		deliveredAt: status === "delivered" ? new Date() : null,
	};
	await db.insert(webhookDeliveries).values(insert);
	await db
		.update(webhookEndpoints)
		.set(status === "delivered" ? { lastDeliveryAt: new Date() } : { lastErrorAt: new Date() })
		.where(eq(webhookEndpoints.id, endpoint.id));
}

/**
 * Hash + display prefix helpers — currently webhook secrets are stored in
 * plaintext for simplicity (delivery time we need it back to sign). Future:
 * encrypt with libsodium / KMS like other long-lived secrets. The receiver
 * never gets the secret again after registration; we surface only the
 * prefix in lists.
 */
export function previewSecret(secret: string): string {
	const hash = createHash("sha256").update(secret).digest("hex").slice(0, 8);
	return `${secret.slice(0, 12)}…${hash}`;
}
