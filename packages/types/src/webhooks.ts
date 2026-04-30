/**
 * `/v1/webhooks/*` — outbound event subscriptions.
 *
 * Each delivery carries a `Flipagent-Signature: t=<unix>,v1=<hex>` header
 * (HMAC-SHA256 over `<t>.<rawBody>` using the endpoint's secret). Stripe-style.
 *
 * The signed timestamp is the dedup primary; the receiver should reject
 * deliveries older than ~5 min to neutralize replay.
 */

import { type Static, Type } from "@sinclair/typebox";
import { BridgeJob } from "./bridge-jobs.js";

export const WebhookEventType = Type.Union(
	[
		// Buy-side purchase order lifecycle.
		Type.Literal("order.queued"),
		Type.Literal("order.claimed"),
		Type.Literal("order.awaiting_user_confirm"),
		Type.Literal("order.placing"),
		Type.Literal("order.completed"),
		Type.Literal("order.failed"),
		Type.Literal("order.cancelled"),
		Type.Literal("order.expired"),
		// Cycle events for online-only reseller automation. Subscribe
		// to drive the connective tissue between stages without wiring
		// orchestration server-side. `data` shape varies per event:
		//
		//   item.sold           { itemId, transactionId, amountCents,
		//                         currency, eventType, occurredAt }
		//   forwarder.received  { provider, packages: [...] }
		//   forwarder.shipped   { provider, packageId, ebayOrderId,
		//                         shipment: { carrier, tracking, … } }
		Type.Literal("item.sold"),
		Type.Literal("forwarder.received"),
		Type.Literal("forwarder.shipped"),
	],
	{ $id: "WebhookEventType" },
);
export type WebhookEventType = Static<typeof WebhookEventType>;

export const WebhookEndpoint = Type.Object(
	{
		id: Type.String({ format: "uuid" }),
		url: Type.String({ format: "uri" }),
		events: Type.Array(WebhookEventType),
		description: Type.Union([Type.String(), Type.Null()]),
		createdAt: Type.String({ format: "date-time" }),
		lastDeliveryAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
		lastErrorAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
	},
	{ $id: "WebhookEndpoint" },
);
export type WebhookEndpoint = Static<typeof WebhookEndpoint>;

export const RegisterWebhookRequest = Type.Object(
	{
		url: Type.String({ format: "uri", minLength: 8, maxLength: 2048 }),
		events: Type.Array(WebhookEventType, { minItems: 1 }),
		description: Type.Optional(Type.String({ maxLength: 200 })),
	},
	{ $id: "RegisterWebhookRequest" },
);
export type RegisterWebhookRequest = Static<typeof RegisterWebhookRequest>;

export const RegisterWebhookResponse = Type.Intersect(
	[
		WebhookEndpoint,
		Type.Object({
			secret: Type.String({ description: "HMAC-SHA256 shared secret. Shown once. Store it on the receiver." }),
		}),
	],
	{ $id: "RegisterWebhookResponse" },
);
export type RegisterWebhookResponse = Static<typeof RegisterWebhookResponse>;

export const ListWebhooksResponse = Type.Object(
	{ endpoints: Type.Array(WebhookEndpoint) },
	{ $id: "ListWebhooksResponse" },
);
export type ListWebhooksResponse = Static<typeof ListWebhooksResponse>;

/**
 * Body shape that we POST to subscribers. The signature header covers the
 * raw body, so the order of keys here is stable (we serialize via
 * `JSON.stringify` once and reuse).
 *
 * `data` is event-shape-specific. Order events (`order.{status}`) carry
 * the full `BridgeJob` row under `data.order` — the field stays named
 * `order` because these events are documented as buy-side purchase-order
 * lifecycle. Cycle events (item.sold / forwarder.*) carry their own
 * minimal payloads — kept untyped here as a free-form record so adding
 * a new cycle event doesn't require a types-package bump on existing
 * receivers. Receivers should branch on `type` and parse accordingly.
 */
export const WebhookEventEnvelope = Type.Object(
	{
		id: Type.String({ format: "uuid", description: "Unique delivery id. Use to idempotently process." }),
		type: WebhookEventType,
		createdAt: Type.String({ format: "date-time" }),
		data: Type.Union([Type.Object({ order: BridgeJob }), Type.Record(Type.String(), Type.Unknown())]),
	},
	{ $id: "WebhookEventEnvelope" },
);
export type WebhookEventEnvelope = Static<typeof WebhookEventEnvelope>;
