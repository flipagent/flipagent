/**
 * `/v1/analytics/*` — seller traffic + standards + service metrics.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Marketplace, ResponseSource } from "./_common.js";

export const TrafficReportRow = Type.Object(
	{
		date: Type.String(),
		listingId: Type.Optional(Type.String()),
		listingViews: Type.Optional(Type.Integer({ minimum: 0 })),
		listingImpressions: Type.Optional(Type.Integer({ minimum: 0 })),
		clickThroughRate: Type.Optional(Type.Number()),
		transactions: Type.Optional(Type.Integer({ minimum: 0 })),
		salesConversionRate: Type.Optional(Type.Number()),
	},
	{ $id: "TrafficReportRow" },
);
export type TrafficReportRow = Static<typeof TrafficReportRow>;

export const TrafficReport = Type.Object(
	{
		marketplace: Marketplace,
		from: Type.String(),
		to: Type.String(),
		rows: Type.Array(TrafficReportRow),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "TrafficReport" },
);
export type TrafficReport = Static<typeof TrafficReport>;

export const SellerStandardsLevel = Type.Union(
	[Type.Literal("top_rated"), Type.Literal("above_standard"), Type.Literal("at_risk"), Type.Literal("below_standard")],
	{ $id: "SellerStandardsLevel" },
);
export type SellerStandardsLevel = Static<typeof SellerStandardsLevel>;

export const SellerStandards = Type.Object(
	{
		marketplace: Marketplace,
		program: Type.String({ description: "PROGRAM_US | PROGRAM_GLOBAL | …" }),
		cycle: Type.String({ description: "CURRENT | PROJECTED" }),
		level: SellerStandardsLevel,
		evaluationCycle: Type.Optional(Type.String()),
		metrics: Type.Optional(
			Type.Array(
				Type.Object({
					name: Type.String(),
					value: Type.Optional(Type.Number()),
					level: Type.Optional(SellerStandardsLevel),
				}),
			),
		),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "SellerStandards" },
);
export type SellerStandards = Static<typeof SellerStandards>;

export const ServiceMetric = Type.Object(
	{
		metric: Type.String({ description: "ITEM_NOT_AS_DESCRIBED | ITEM_NOT_RECEIVED | LATE_SHIPMENT | …" }),
		level: SellerStandardsLevel,
		count: Type.Integer({ minimum: 0 }),
		percentage: Type.Optional(Type.Number()),
	},
	{ $id: "ServiceMetric" },
);
export type ServiceMetric = Static<typeof ServiceMetric>;

export const ServiceMetricsResponse = Type.Object(
	{
		marketplace: Marketplace,
		metrics: Type.Array(ServiceMetric),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "ServiceMetricsResponse" },
);
export type ServiceMetricsResponse = Static<typeof ServiceMetricsResponse>;
