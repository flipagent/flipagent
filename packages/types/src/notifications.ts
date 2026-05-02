/**
 * `/v1/notifications/subscriptions` — eBay notification subscription
 * CRUD (commerce/notification). Distinct from inbound webhook delivery
 * (`/v1/notifications/ebay/inbound`) which is the sink, and from
 * `/v1/webhooks` which manages flipagent's outbound dispatch.
 */

import { type Static, Type } from "@sinclair/typebox";
import { ResponseSource } from "./_common.js";

export const NotificationSubscription = Type.Object(
	{
		id: Type.String(),
		topicId: Type.String({ description: "ITEM_SOLD | RETURN_OPENED | …" }),
		destinationId: Type.String(),
		status: Type.Union([Type.Literal("enabled"), Type.Literal("disabled")]),
		filterExpression: Type.Optional(Type.String()),
	},
	{ $id: "NotificationSubscription" },
);
export type NotificationSubscription = Static<typeof NotificationSubscription>;

export const NotificationSubscriptionCreate = Type.Object(
	{
		topicId: Type.String(),
		destinationId: Type.String(),
		filterExpression: Type.Optional(Type.String()),
	},
	{ $id: "NotificationSubscriptionCreate" },
);
export type NotificationSubscriptionCreate = Static<typeof NotificationSubscriptionCreate>;

export const NotificationSubscriptionsListResponse = Type.Object(
	{ subscriptions: Type.Array(NotificationSubscription), source: Type.Optional(ResponseSource) },
	{ $id: "NotificationSubscriptionsListResponse" },
);
export type NotificationSubscriptionsListResponse = Static<typeof NotificationSubscriptionsListResponse>;

export const NotificationDestination = Type.Object(
	{
		id: Type.String(),
		name: Type.String(),
		endpoint: Type.String(),
		credentials: Type.Optional(Type.Object({ verificationToken: Type.Optional(Type.String()) })),
	},
	{ $id: "NotificationDestination" },
);
export type NotificationDestination = Static<typeof NotificationDestination>;

export const NotificationTopic = Type.Object(
	{
		id: Type.String(),
		name: Type.Optional(Type.String()),
		description: Type.Optional(Type.String()),
		schemaVersion: Type.Optional(Type.String()),
	},
	{ $id: "NotificationTopic" },
);
export type NotificationTopic = Static<typeof NotificationTopic>;
