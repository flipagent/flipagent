/**
 * `/v1/charities` — eBay for Charity organizations (commerce/charity).
 */

import { type Static, Type } from "@sinclair/typebox";
import { Page } from "./_common.js";

export const Charity = Type.Object(
	{
		id: Type.String({ description: "charityOrgId." }),
		ein: Type.Optional(Type.String({ description: "Employer Identification Number." })),
		name: Type.String(),
		mission: Type.Optional(Type.String()),
		description: Type.Optional(Type.String()),
		logoUrl: Type.Optional(Type.String()),
		websiteUrl: Type.Optional(Type.String()),
	},
	{ $id: "Charity" },
);
export type Charity = Static<typeof Charity>;

export const CharitiesListQuery = Type.Object(
	{
		q: Type.Optional(Type.String()),
		ein: Type.Optional(Type.String()),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
		offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
	},
	{ $id: "CharitiesListQuery" },
);
export type CharitiesListQuery = Static<typeof CharitiesListQuery>;

export const CharitiesListResponse = Type.Composite([Page, Type.Object({ charities: Type.Array(Charity) })], {
	$id: "CharitiesListResponse",
});
export type CharitiesListResponse = Static<typeof CharitiesListResponse>;
