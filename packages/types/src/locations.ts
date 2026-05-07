/**
 * `/v1/locations/*` — merchant warehouse / pickup locations.
 * Wraps eBay sell/inventory/v1/location.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Address } from "./_common.js";

export const LocationStatus = Type.Union([Type.Literal("enabled"), Type.Literal("disabled")], {
	$id: "LocationStatus",
});
export type LocationStatus = Static<typeof LocationStatus>;

export const Location = Type.Object(
	{
		id: Type.String({ description: "merchantLocationKey." }),
		name: Type.Optional(Type.String()),
		phone: Type.Optional(Type.String()),
		address: Address,
		locationTypes: Type.Optional(Type.Array(Type.String({ description: "STORE | WAREHOUSE | …" }))),
		status: LocationStatus,
		hours: Type.Optional(
			Type.Array(
				Type.Object({
					dayOfWeekEnum: Type.String(),
					intervals: Type.Array(Type.Object({ open: Type.String(), close: Type.String() })),
				}),
			),
		),
		specialHours: Type.Optional(
			Type.Array(
				Type.Object({
					date: Type.String(),
					intervals: Type.Array(Type.Object({ open: Type.String(), close: Type.String() })),
				}),
			),
		),
		instructions: Type.Optional(Type.String()),
	},
	{ $id: "Location" },
);
export type Location = Static<typeof Location>;

export const LocationCreate = Type.Object(
	{
		name: Type.Optional(Type.String()),
		phone: Type.Optional(Type.String()),
		address: Address,
		locationTypes: Type.Optional(Type.Array(Type.String())),
		instructions: Type.Optional(Type.String()),
	},
	{ $id: "LocationCreate" },
);
export type LocationCreate = Static<typeof LocationCreate>;

export const LocationsListResponse = Type.Object({ locations: Type.Array(Location) }, { $id: "LocationsListResponse" });
export type LocationsListResponse = Static<typeof LocationsListResponse>;
