/**
 * `/v1/violations` — sell-side listing compliance. Wraps eBay
 * sell/compliance.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Marketplace, Page, ResponseSource } from "./_common.js";

export const ViolationSeverity = Type.Union(
	[Type.Literal("info"), Type.Literal("warning"), Type.Literal("critical"), Type.Literal("listing_blocked")],
	{ $id: "ViolationSeverity" },
);
export type ViolationSeverity = Static<typeof ViolationSeverity>;

export const Violation = Type.Object(
	{
		id: Type.String(),
		marketplace: Marketplace,
		listingId: Type.String(),
		sku: Type.Optional(Type.String()),
		severity: ViolationSeverity,
		complianceType: Type.String({
			description: "ABSTRACT_LISTING_VIOLATION | COMPLETE_PRODUCT_LIST | MISSING_REQUIRED_FIELD | PRICE_GOUGING | …",
		}),
		message: Type.String(),
		title: Type.Optional(Type.String()),
		recommendation: Type.Optional(Type.String()),
		policyName: Type.Optional(Type.String()),
		violationCount: Type.Optional(Type.Integer({ minimum: 0 })),
		complianceState: Type.Optional(Type.String({ description: "AT_RISK | NON_COMPLIANT | …" })),
		respondBy: Type.Optional(Type.String()),
	},
	{ $id: "Violation" },
);
export type Violation = Static<typeof Violation>;

export const ViolationsListQuery = Type.Object(
	{
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
		offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
		listingId: Type.Optional(Type.String()),
		complianceType: Type.Optional(Type.String()),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "ViolationsListQuery" },
);
export type ViolationsListQuery = Static<typeof ViolationsListQuery>;

export const ViolationsListResponse = Type.Composite(
	[Page, Type.Object({ violations: Type.Array(Violation), source: Type.Optional(ResponseSource) })],
	{ $id: "ViolationsListResponse" },
);
export type ViolationsListResponse = Static<typeof ViolationsListResponse>;

export const ViolationSummary = Type.Object(
	{
		complianceType: Type.String(),
		listingCount: Type.Integer({ minimum: 0 }),
		severity: ViolationSeverity,
	},
	{ $id: "ViolationSummary" },
);
export type ViolationSummary = Static<typeof ViolationSummary>;

export const ViolationsSummaryResponse = Type.Object(
	{ summaries: Type.Array(ViolationSummary), source: Type.Optional(ResponseSource) },
	{ $id: "ViolationsSummaryResponse" },
);
export type ViolationsSummaryResponse = Static<typeof ViolationsSummaryResponse>;

/**
 * `POST /v1/violations/{id}/suppress` — suppress a false-positive
 * compliance flag. eBay accepts the listing-violation id + reason.
 * Wraps `/sell/compliance/v1/suppress_listing_violation`.
 */
export const ViolationSuppressRequest = Type.Object(
	{
		listingId: Type.String({ description: "The listing whose violation should be suppressed." }),
		complianceType: Type.Optional(Type.String({ description: "Limits the suppression to one compliance type." })),
		reason: Type.Optional(Type.String()),
	},
	{ $id: "ViolationSuppressRequest" },
);
export type ViolationSuppressRequest = Static<typeof ViolationSuppressRequest>;

export const ViolationSuppressResponse = Type.Object(
	{ ok: Type.Boolean(), source: Type.Optional(ResponseSource) },
	{ $id: "ViolationSuppressResponse" },
);
export type ViolationSuppressResponse = Static<typeof ViolationSuppressResponse>;
