/**
 * `/v1/me/{quota,programs}` — caller's API quota + seller-program
 * enrollment. Backed by REST `developer/analytics/v1_beta/*` and
 * `sell/account/v1/program/*`.
 */

import { type Static, Type } from "@sinclair/typebox";
import { ResponseSource } from "./_common.js";

export const QuotaResource = Type.Object(
	{
		name: Type.String({ description: "API method name." }),
		limit: Type.Optional(Type.Integer({ description: "Calls allowed in the current window." })),
		remaining: Type.Optional(Type.Integer({ description: "Calls left in the current window." })),
		reset: Type.Optional(Type.String({ description: "ISO 8601 — when the window rolls over." })),
		timeWindow: Type.Optional(Type.Integer({ description: "Seconds in the current window." })),
	},
	{ $id: "QuotaResource" },
);
export type QuotaResource = Static<typeof QuotaResource>;

export const QuotaApi = Type.Object(
	{
		apiContext: Type.String({ description: "buy | sell | commerce | developer | tradingapi." }),
		apiName: Type.String(),
		apiVersion: Type.String(),
		resources: Type.Array(QuotaResource),
	},
	{ $id: "QuotaApi" },
);
export type QuotaApi = Static<typeof QuotaApi>;

export const MeQuotaResponse = Type.Object(
	{
		apiQuota: Type.Array(QuotaApi, { description: "App-wide rate limits (rate_limit endpoint)." }),
		userQuota: Type.Array(QuotaApi, { description: "Per-user rate limits (user_rate_limit endpoint)." }),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "MeQuotaResponse" },
);
export type MeQuotaResponse = Static<typeof MeQuotaResponse>;

export const ProgramType = Type.Union(
	[
		Type.Literal("SELLING_POLICY_MANAGEMENT"),
		Type.Literal("OUT_OF_STOCK_CONTROL"),
		Type.Literal("PARTNER_MOTORS_DEALER"),
		Type.Literal("EBAY_PLUS_PROGRAM"),
	],
	{ $id: "ProgramType" },
);
export type ProgramType = Static<typeof ProgramType>;

export const MeProgramsResponse = Type.Object(
	{
		programs: Type.Array(Type.Object({ programType: Type.String() })),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "MeProgramsResponse" },
);
export type MeProgramsResponse = Static<typeof MeProgramsResponse>;

export const ProgramOptRequest = Type.Object({ programType: ProgramType }, { $id: "ProgramOptRequest" });
export type ProgramOptRequest = Static<typeof ProgramOptRequest>;

export const ProgramOptResponse = Type.Object(
	{
		programType: Type.String(),
		ok: Type.Boolean(),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "ProgramOptResponse" },
);
export type ProgramOptResponse = Static<typeof ProgramOptResponse>;
