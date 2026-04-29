/**
 * `/v1/forwarder/{provider}/*` schemas — package forwarder ops.
 *
 * Forwarders sit on the boundary of buy and sell flows. A reseller
 * uses a forwarder to:
 *   - receive items bought from international sellers (inbound)
 *   - consolidate multiple inbound packages into one shipment
 *   - sometimes ship outbound to buyers when listing from forwarder stock
 *
 * Surface is provider-namespaced so each forwarder's specifics
 * (Planet Express, MyUS, Stackry, …) live behind their own
 * `/v1/forwarder/{provider}/*` segment without leaking into the
 * marketplace-agnostic core.
 *
 * Today only `planetexpress` is wired. Adding a new forwarder = drop
 * a content-script handler in the extension + an entry in
 * `BRIDGE_TASKS` + bridge-task service.
 */

import { type Static, Type } from "@sinclair/typebox";

export const ForwarderProvider = Type.Union([Type.Literal("planetexpress")], { $id: "ForwarderProvider" });
export type ForwarderProvider = Static<typeof ForwarderProvider>;

export const ForwarderJobStatus = Type.Union(
	[
		Type.Literal("queued"),
		Type.Literal("running"),
		Type.Literal("completed"),
		Type.Literal("failed"),
		Type.Literal("cancelled"),
		Type.Literal("expired"),
	],
	{ $id: "ForwarderJobStatus" },
);
export type ForwarderJobStatus = Static<typeof ForwarderJobStatus>;

export const ForwarderPackage = Type.Object(
	{
		id: Type.String(),
		trackingNumber: Type.Optional(Type.String()),
		carrier: Type.Optional(Type.String()),
		description: Type.Optional(Type.String()),
		weightG: Type.Optional(Type.Integer()),
		receivedAt: Type.Optional(Type.String({ format: "date-time" })),
		state: Type.Optional(
			Type.String({ description: "provider-specific state — 'received', 'on_hand', 'shipped', etc." }),
		),
	},
	{ $id: "ForwarderPackage" },
);
export type ForwarderPackage = Static<typeof ForwarderPackage>;

export const ForwarderRefreshResponse = Type.Object(
	{
		jobId: Type.String({ format: "uuid" }),
		status: ForwarderJobStatus,
		expiresAt: Type.String({ format: "date-time" }),
	},
	{ $id: "ForwarderRefreshResponse" },
);
export type ForwarderRefreshResponse = Static<typeof ForwarderRefreshResponse>;

export const ForwarderJobResponse = Type.Object(
	{
		jobId: Type.String({ format: "uuid" }),
		provider: ForwarderProvider,
		status: ForwarderJobStatus,
		packages: Type.Optional(Type.Array(ForwarderPackage)),
		failureReason: Type.Union([Type.String(), Type.Null()]),
		createdAt: Type.String({ format: "date-time" }),
		updatedAt: Type.String({ format: "date-time" }),
		expiresAt: Type.String({ format: "date-time" }),
	},
	{ $id: "ForwarderJobResponse" },
);
export type ForwarderJobResponse = Static<typeof ForwarderJobResponse>;
