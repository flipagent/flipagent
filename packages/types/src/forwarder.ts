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
import { NextAction } from "./_common.js";

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

/**
 * Per-package photos captured at intake by the forwarder. PE attaches
 * 2-6 photos per inbound parcel (front/back/condition shots). Bridge
 * task scrapes the package detail page and returns the image URLs.
 */
export const ForwarderPackagePhoto = Type.Object(
	{
		url: Type.String({ format: "uri" }),
		capturedAt: Type.Optional(Type.String({ format: "date-time" })),
		caption: Type.Optional(Type.String()),
	},
	{ $id: "ForwarderPackagePhoto" },
);
export type ForwarderPackagePhoto = Static<typeof ForwarderPackagePhoto>;

export const ForwarderShipmentRequest = Type.Object(
	{
		toAddress: Type.Object({
			name: Type.String(),
			line1: Type.String(),
			line2: Type.Optional(Type.String()),
			city: Type.String(),
			state: Type.String({ description: "ISO 3166-2 region; for US use 2-letter (e.g. NY)" }),
			postalCode: Type.String(),
			country: Type.String({ description: "ISO 3166-1 alpha-2 (e.g. US, KR)" }),
			phone: Type.Optional(Type.String()),
			email: Type.Optional(Type.String({ format: "email" })),
		}),
		service: Type.Optional(
			Type.Union([
				Type.Literal("usps_priority"),
				Type.Literal("usps_ground_advantage"),
				Type.Literal("ups_ground"),
				Type.Literal("fedex_home"),
			]),
		),
		declaredValueCents: Type.Optional(Type.Integer({ minimum: 0 })),
		ebayOrderId: Type.Optional(Type.String({ description: "Origin marketplace order id, for traceability." })),
		notes: Type.Optional(Type.String()),
	},
	{ $id: "ForwarderShipmentRequest" },
);
export type ForwarderShipmentRequest = Static<typeof ForwarderShipmentRequest>;

/**
 * The shipment row a successful dispatch produces. `shipmentId` is
 * provider-internal (PE's outbound shipment id); `tracking` is the
 * carrier's tracking number once a label is generated. Both can be
 * null while the bridge is mid-flight.
 */
export const ForwarderShipment = Type.Object(
	{
		shipmentId: Type.Union([Type.String(), Type.Null()]),
		carrier: Type.Union([Type.String(), Type.Null()]),
		tracking: Type.Union([Type.String(), Type.Null()]),
		costCents: Type.Union([Type.Integer(), Type.Null()]),
		labelUrl: Type.Union([Type.String({ format: "uri" }), Type.Null()]),
		shippedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
	},
	{ $id: "ForwarderShipment" },
);
export type ForwarderShipment = Static<typeof ForwarderShipment>;

/**
 * Forwarder inventory row — one per package the user holds at the
 * forwarder. Reconciled by the bridge result handler; queryable via
 * `GET /v1/forwarder/{provider}/inventory[/{packageId}]`. Linked to
 * a marketplace sku via `POST .../packages/{packageId}/link` so the
 * sold-event handler can find the package without the agent
 * threading the mapping by hand.
 */
export const ForwarderInventoryStatus = Type.Union(
	[
		Type.Literal("received"),
		Type.Literal("photographed"),
		Type.Literal("listed"),
		Type.Literal("sold"),
		Type.Literal("dispatched"),
		Type.Literal("shipped"),
	],
	{ $id: "ForwarderInventoryStatus" },
);
export type ForwarderInventoryStatus = Static<typeof ForwarderInventoryStatus>;

export const ForwarderInventoryRow = Type.Object(
	{
		id: Type.String({ format: "uuid" }),
		provider: ForwarderProvider,
		packageId: Type.String(),
		sku: Type.Union([Type.String(), Type.Null()]),
		ebayOfferId: Type.Union([Type.String(), Type.Null()]),
		ebayInboundOrderId: Type.Union([Type.String(), Type.Null()]),
		status: ForwarderInventoryStatus,
		photos: Type.Union([Type.Array(ForwarderPackagePhoto), Type.Null()]),
		weightG: Type.Union([Type.Integer(), Type.Null()]),
		dimsCm: Type.Union([
			Type.Object({
				l: Type.Optional(Type.Number()),
				w: Type.Optional(Type.Number()),
				h: Type.Optional(Type.Number()),
			}),
			Type.Null(),
		]),
		inboundTracking: Type.Union([Type.String(), Type.Null()]),
		outboundShipmentId: Type.Union([Type.String(), Type.Null()]),
		outboundCarrier: Type.Union([Type.String(), Type.Null()]),
		outboundTracking: Type.Union([Type.String(), Type.Null()]),
		outboundCostCents: Type.Union([Type.Integer(), Type.Null()]),
		outboundLabelUrl: Type.Union([Type.String(), Type.Null()]),
		shippedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
		createdAt: Type.String({ format: "date-time" }),
		updatedAt: Type.String({ format: "date-time" }),
	},
	{ $id: "ForwarderInventoryRow" },
);
export type ForwarderInventoryRow = Static<typeof ForwarderInventoryRow>;

export const ForwarderInventoryListResponse = Type.Object(
	{ rows: Type.Array(ForwarderInventoryRow) },
	{ $id: "ForwarderInventoryListResponse" },
);
export type ForwarderInventoryListResponse = Static<typeof ForwarderInventoryListResponse>;

export const ForwarderLinkRequest = Type.Object(
	{
		sku: Type.String({ minLength: 1, maxLength: 200 }),
		ebayOfferId: Type.Optional(Type.String({ maxLength: 200 })),
	},
	{ $id: "ForwarderLinkRequest" },
);
export type ForwarderLinkRequest = Static<typeof ForwarderLinkRequest>;

export const ForwarderAddress = Type.Object(
	{
		/** Warehouse label as the forwarder presents it (e.g. "Torrance, CA"). Many forwarders offer multiple warehouses (US east/west, no-sales-tax states, UK) and the label is the agent's hint for which to pick. */
		label: Type.String(),
		/** True for the warehouse the forwarder treats as the user's default — first-mailout, the "active" tab in the dashboard. Exactly one address has `isPrimary: true`. */
		isPrimary: Type.Boolean(),
		name: Type.String({
			description: "Recipient name printed on labels (typically the user's account name + suite).",
		}),
		line1: Type.String(),
		line2: Type.Optional(Type.String({ description: "Suite / unit number assigned to the user by the forwarder." })),
		city: Type.String(),
		region: Type.Optional(
			Type.String({
				description:
					"ISO 3166-2 region; for US use 2-letter (e.g. NV). Optional because some non-US warehouses (e.g. UK) don't expose a state/region field.",
			}),
		),
		postalCode: Type.String(),
		country: Type.String({ description: "ISO 3166-1 alpha-2 (e.g. US)." }),
		phone: Type.Optional(Type.String()),
	},
	{ $id: "ForwarderAddress" },
);
export type ForwarderAddress = Static<typeof ForwarderAddress>;

export const ForwarderJobResponse = Type.Object(
	{
		jobId: Type.String({ format: "uuid" }),
		provider: ForwarderProvider,
		status: ForwarderJobStatus,
		/** Set when this job's task was `forwarder.refresh`. */
		packages: Type.Optional(Type.Array(ForwarderPackage)),
		/** Set when this job's task was `forwarder.photos`. */
		photos: Type.Optional(Type.Array(ForwarderPackagePhoto)),
		/** Set when this job's task was `forwarder.dispatch`. */
		shipment: Type.Optional(ForwarderShipment),
		/** Set when this job's task was `forwarder.address`. Some forwarders (Planet Express, MyUS, …) operate multiple warehouses and the user can ship to any of them; the array holds them all. Exactly one entry has `isPrimary: true`. */
		addresses: Type.Optional(Type.Array(ForwarderAddress)),
		/**
		 * Deeplink to drive the action forward when no Chrome extension
		 * is paired. Currently emitted only for `forwarder.dispatch`
		 * jobs (the user clicks Send Mailout on the forwarder's own UI).
		 * Refresh / photos / address scrapes are extension-only because
		 * they require authenticated DOM access, not a single click.
		 */
		nextAction: Type.Optional(NextAction),
		failureReason: Type.Union([Type.String(), Type.Null()]),
		createdAt: Type.String({ format: "date-time" }),
		updatedAt: Type.String({ format: "date-time" }),
		expiresAt: Type.String({ format: "date-time" }),
	},
	{ $id: "ForwarderJobResponse" },
);
export type ForwarderJobResponse = Static<typeof ForwarderJobResponse>;
