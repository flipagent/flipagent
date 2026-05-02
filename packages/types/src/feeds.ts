/**
 * `/v1/feeds/*` — bulk async tasks (sell/feed + buy/feed).
 */

import { type Static, Type } from "@sinclair/typebox";
import { Marketplace, ResponseSource } from "./_common.js";

export const FeedKind = Type.Union(
	[
		Type.Literal("listing"),
		Type.Literal("inventory"),
		Type.Literal("order"),
		Type.Literal("customer_service_metric"),
		Type.Literal("buy_item"),
		Type.Literal("buy_item_group"),
		Type.Literal("buy_item_priority_descriptor"),
		Type.Literal("buy_item_snapshot"),
	],
	{ $id: "FeedKind" },
);
export type FeedKind = Static<typeof FeedKind>;

export const FeedTaskStatus = Type.Union(
	[
		Type.Literal("queued"),
		Type.Literal("processing"),
		Type.Literal("completed"),
		Type.Literal("failed"),
		Type.Literal("cancelled"),
	],
	{ $id: "FeedTaskStatus" },
);
export type FeedTaskStatus = Static<typeof FeedTaskStatus>;

export const FeedTask = Type.Object(
	{
		id: Type.String(),
		marketplace: Marketplace,
		kind: FeedKind,
		status: FeedTaskStatus,
		feedType: Type.Optional(Type.String()),
		schemaVersion: Type.Optional(Type.String()),
		uploadUrl: Type.Optional(Type.String()),
		downloadUrl: Type.Optional(Type.String()),
		createdAt: Type.String(),
		completedAt: Type.Optional(Type.String()),
	},
	{ $id: "FeedTask" },
);
export type FeedTask = Static<typeof FeedTask>;

export const FeedTaskCreate = Type.Object(
	{
		kind: FeedKind,
		feedType: Type.String({
			description: "eBay feedType — e.g. LMS_ACTIVE_INVENTORY_REPORT, LMS_ORDER_REPORT, INVENTORY_TASK.",
		}),
		schemaVersion: Type.Optional(Type.String()),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "FeedTaskCreate" },
);
export type FeedTaskCreate = Static<typeof FeedTaskCreate>;

export const FeedsListResponse = Type.Object(
	{ tasks: Type.Array(FeedTask), source: Type.Optional(ResponseSource) },
	{ $id: "FeedsListResponse" },
);
export type FeedsListResponse = Static<typeof FeedsListResponse>;
