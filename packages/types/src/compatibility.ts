/**
 * `/v1/items/check-compatibility` + `/v1/categories/{id}/compatibility-properties` —
 * parts/motors compatibility (eBay buy/browse + commerce/taxonomy).
 */

import { type Static, Type } from "@sinclair/typebox";
export const CompatibilityCheckRequest = Type.Object(
	{
		itemId: Type.String(),
		compatibilityProperties: Type.Array(Type.Object({ name: Type.String(), value: Type.String() }), { minItems: 1 }),
	},
	{ $id: "CompatibilityCheckRequest" },
);
export type CompatibilityCheckRequest = Static<typeof CompatibilityCheckRequest>;

export const CompatibilityCheckResponse = Type.Object(
	{
		compatible: Type.Boolean(),
		warnings: Type.Optional(Type.Array(Type.String())),
	},
	{ $id: "CompatibilityCheckResponse" },
);
export type CompatibilityCheckResponse = Static<typeof CompatibilityCheckResponse>;

export const CompatibilityProperty = Type.Object(
	{
		name: Type.String(),
		localizedName: Type.Optional(Type.String()),
	},
	{ $id: "CompatibilityProperty" },
);
export type CompatibilityProperty = Static<typeof CompatibilityProperty>;

export const CompatibilityPropertyValueQuery = Type.Object(
	{
		propertyName: Type.String(),
		filter: Type.Optional(Type.String()),
	},
	{ $id: "CompatibilityPropertyValueQuery" },
);
export type CompatibilityPropertyValueQuery = Static<typeof CompatibilityPropertyValueQuery>;

export const CompatibilityPropertiesResponse = Type.Object(
	{
		properties: Type.Array(CompatibilityProperty),
	},
	{ $id: "CompatibilityPropertiesResponse" },
);
export type CompatibilityPropertiesResponse = Static<typeof CompatibilityPropertiesResponse>;
